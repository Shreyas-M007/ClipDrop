import * as Y from "yjs";

const WEB_PAD_LIMIT = 256 * 1024;
const WEB_PAD_TEXT_LIMIT = 50_000;
const WEB_PAD_STATE_LIMIT = 768 * 1024;
const MEDIA_TYPES = /^(?:audio\/(?:mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|video\/(?:mp4|webm|ogg|quicktime))$/;

function generation(room) {
  return room.generation || "legacy";
}

function roomPartition(key, room) {
  return room.generation ? key + "/g/" + room.generation : key;
}

function decodeUpdate(input) {
  return Uint8Array.from(atob(input), character => character.charCodeAt(0));
}

function encodeUpdate(input) {
  let binary = "";
  for (let i = 0; i < input.length; i += 8192) binary += String.fromCharCode(...input.subarray(i, i + 8192));
  return btoa(binary);
}

async function readBoundedBlob(request, limit) {
  if (Number(request.headers.get("Content-Length")) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

async function clearPartition(bucket, partition) {
  for (const dir of ["/posts/", "/workspace/"]) {
    let cursor;
    do {
      const page = await bucket.list({ prefix: partition + dir, cursor, limit: 100 });
      if (page.objects.length) await bucket.delete(page.objects.map(object => object.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

async function handleWorkspace(request, bucket, context, roomKey, roomObject, room, partition, action) {
  const current = generation(room);
  if (action === "reset") {
    if (request.method !== "POST") return error("Use the room’s clear action.", 405);
    const updated = { ...room, generation: crypto.randomUUID() };
    const saved = await bucket.put(roomKey, JSON.stringify(updated), { onlyIf: { etagMatches: roomObject.etag } });
    if (!saved) return error("The room changed. Reload it before clearing.", 409);
    context.waitUntil(clearPartition(bucket, partition).catch(() => {}));
    return json({ generation: updated.generation });
  }

  const key = partition + "/workspace/pad";
  if (request.method === "GET") {
    const stored = await bucket.get(key);
    const revision = stored?.etag ?? null;
    if (revision && request.headers.get("X-Pad-Revision") === revision) {
      return json({ generation: current, revision, unchanged: true });
    }
    const data = stored ? new Uint8Array(await stored.arrayBuffer()) : null;
    return json({ generation: current, revision, state: data ? encodeUpdate(data) : "" });
  }
  if (request.method !== "POST") return error("Unsupported scratchpad action.", 405);
  const input = await readBoundedBlob(request, WEB_PAD_LIMIT);
  if (!input || !input.length) return error("The scratchpad update is empty or too large.", 400);
  for (let attempt = 0; attempt < 7; attempt++) {
    const doc = new Y.Doc();
    const pad = doc.getText("pad");
    const stored = await bucket.get(key);
    let state;
    try {
      if (stored) Y.applyUpdate(doc, new Uint8Array(await stored.arrayBuffer()));
      Y.applyUpdate(doc, input);
      state = Y.encodeStateAsUpdate(doc);
      if (pad.length > WEB_PAD_TEXT_LIMIT || state.length > WEB_PAD_STATE_LIMIT) {
        return error("This scratchpad has reached its size limit.", 413);
      }
      if (doc.share.size !== 1 || pad.toDelta().some(part => typeof part.insert !== "string" || part.attributes)) {
        return error("Invalid scratchpad update.", 400);
      }
    } catch {
      return error("Invalid scratchpad update.", 400);
    } finally {
      doc.destroy();
    }
    const saved = await bucket.put(key, state, {
      onlyIf: stored ? { etagMatches: stored.etag } : { etagDoesNotMatch: "*" },
    });
    if (saved) {
      const latest = await bucket.get(roomKey);
      if (!latest || generation(await latest.json()) !== current) {
        await bucket.delete(key);
        return error("This room was cleared.", 410);
      }
      return json({ generation: current, state: encodeUpdate(state) });
    }
  }
  return error("The scratchpad is busy. Try again.", 503);
}

async function browserIdentity(request) {
  const key = request.headers.get("X-Clipdrop-Client");
  return key && /^[a-f0-9]{48}$/.test(key) ? tokenHash(key) : null;
}

function postExpiry(metadata) {
  return metadata.expiresAt ? Number(metadata.expiresAt) : 0;
}

async function claimRoomPost(request, bucket, context, postKey, post, metadata, body) {
  const owner = await browserIdentity(request);
  const expiresAt = postExpiry(post.customMetadata);
  if (!expiresAt) return error("This post is not sensitive.", 400);
  if (!owner || owner === post.customMetadata.owner) return error("Only a recipient can open this sensitive post.", 403);
  if (expiresAt <= Date.now()) return error("This post has expired.", 404);
  const file = body.attachments[0];
  let content;
  if (file?.size) {
    content = await bucket.get(postKey, {
      onlyIf: { etagMatches: post.etag },
      range: { offset: Number(post.customMetadata.metadataSize), length: file.size },
    });
    if (!content?.body) return error("This post was already opened.", 404);
  }
  const removed = expiresAt > Date.now() && await bucket.put(postKey, crypto.randomUUID(), {
    onlyIf: { etagMatches: post.etag }, customMetadata: { retired: "1" },
  });
  if (!removed) {
    if (content?.body) await content.body.cancel().catch(() => {});
    return error("This post was already opened or expired.", 404);
  }
  context.waitUntil(bucket.delete(postKey).catch(() => {}));
  if (!file) return json({ value: body.value });
  return new Response(content?.body ?? null, { headers: { ...policy, "Content-Type": "application/octet-stream",
    "Content-Length": String(file.size), "Content-Disposition": "attachment" } });
}

function mediaRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? [start, end] : null;
}

async function streamRoomMedia(request, bucket, key, post, file) {
  const rangeHeader = request.headers.get("Range");
  const bounds = rangeHeader ? mediaRange(rangeHeader, file.size) : null;
  if (rangeHeader && !bounds) return new Response(null, { status: 416, headers: { ...policy, "Content-Range": "bytes */" + file.size } });
  const [start, end] = bounds ?? [0, file.size - 1];
  const length = end - start + 1;
  const content = length ? await bucket.get(key, {
    onlyIf: { etagMatches: post.etag }, range: { offset: Number(post.customMetadata.metadataSize) + start, length },
  }) : null;
  if (length && !content?.body) return error("Media is unavailable.", 404);
  return new Response(content?.body ?? null, { status: bounds ? 206 : 200, headers: {
    ...policy, "Content-Type": file.type, "Accept-Ranges": "bytes", "Content-Length": String(length),
    ...(bounds ? { "Content-Range": "bytes " + start + "-" + end + "/" + file.size } : {}),
  } });
}

const PEER_ID = /^[a-f0-9]{64}$/;

function hostSDP(sdp) {
  return sdp.replace(/^a=candidate:.*\r?\n?/gm, line => /\btyp host(?:\s|$)/.test(line) ? line : "");
}

async function signalingJSON(request, limit) {
  const bytes = await readBoundedBlob(request, limit);
  if (!bytes?.length) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

async function handleScreen(request, bucket, context, partition, action) {
  if (request.method !== "POST") return error("Unsupported screen sharing action.", 405);
  const id = await browserIdentity(request);
  if (!id) return error("Reopen the room to establish a screen sharing session.", 403);
  const prefix = partition + "/workspace/";
  const presence = prefix + "peers/";
  const inbox = prefix + "signals/" + id + "/";

  if (action === "presence") {
    const input = await signalingJSON(request, 2048);
    if (typeof input?.active !== "boolean") return error("Invalid presence state.", 400);
    if (input.leave === true) {
      await bucket.delete(presence + id);
      return json({});
    }
    const now = Date.now();
    await bucket.put(presence + id, "", {
      customMetadata: { active: input.active ? "1" : "0", expiresAt: String(now + 14_000) },
    });
    const [peers, signals] = await Promise.all([
      bucket.list({ prefix: presence, include: ["customMetadata"], limit: 48 }),
      bucket.list({ prefix: inbox, include: ["customMetadata"], limit: 48 }),
    ]);
    const expired = [...peers.objects, ...signals.objects].filter(record => Number(record.customMetadata?.expiresAt) <= now);
    const members = peers.objects.filter(record => Number(record.customMetadata?.expiresAt) > now);
    const deliveries = signals.objects.filter(record => Number(record.customMetadata?.expiresAt) > now);
    const messages = (await Promise.all(deliveries.map(async record => {
      const object = await bucket.get(record.key);
      return object ? { key: record.key.slice(inbox.length), ...await object.json() } : null;
    }))).filter(Boolean);
    const remove = [...expired.map(record => record.key), ...deliveries.map(record => record.key)];
    if (remove.length) context.waitUntil(bucket.delete(remove).catch(() => {}));
    return json({
      id, messages,
      members: members.map(record => record.key.slice(presence.length)),
      broadcasters: members.filter(record => record.customMetadata.active === "1").map(record => record.key.slice(presence.length)),
    });
  }

  const input = await signalingJSON(request, 170_000);
  const { target, broadcaster } = input ?? {};
  if (!PEER_ID.test(target ?? "") || !PEER_ID.test(broadcaster ?? "") || target === id ||
      (broadcaster !== target && broadcaster !== id)) return error("Invalid screen sharing peer.", 400);
  const now = Date.now();
  const [sender, receiver] = await Promise.all([bucket.head(presence + id), bucket.head(presence + target)]);
  const source = broadcaster === id ? sender : receiver;
  if (!sender || !receiver || source.customMetadata.active !== "1" ||
      [sender, receiver].some(peer => Number(peer.customMetadata.expiresAt) <= now)) {
    return error("The viewer or broadcaster is no longer connected.", 404);
  }
  let message = { sender: id, broadcaster };
  if (input.description) {
    const expected = broadcaster === id ? "offer" : "answer";
    const { type, sdp } = input.description;
    if (type !== expected || typeof sdp !== "string" || sdp.length > 150_000) return error("Invalid screen description.", 400);
    message.description = { type, sdp: hostSDP(sdp) };
  } else {
    const candidate = input.candidate;
    if (typeof candidate?.candidate !== "string" || candidate.candidate.length > 1500 ||
        !/\btyp host(?:\s|$)/.test(candidate.candidate)) return error("Only host ICE candidates are accepted.", 400);
    message.candidate = { candidate: candidate.candidate, sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment };
  }
  await bucket.put(prefix + "signals/" + target + "/" + now + "-" + crypto.randomUUID(), JSON.stringify(message),
    { customMetadata: { expiresAt: String(now + 20_000) } });
  return json({});
}
