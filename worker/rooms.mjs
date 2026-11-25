const POST_KINDS = ["text", "links", "images", "files"];
const POST_ID = /^\d{13}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PAGE_SIZE = 18;

async function createRoom(request, bucket) {
  const form = await readForm(request, 8192);
  if (form instanceof Response) return form;
  const value = form.get("name") ?? "";
  const requested = requestedCode(form);
  if (typeof value !== "string" || value.length > 60) return error("Use up to 60 characters for the room name.", 400);
  if (requested === null) return error(CODE_HELP, 400);

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = requested || shareCode();
    const room = { code, name: value.trim() || "Shared room", createdAt: Date.now() };
    const saved = await bucket.put("rooms/" + codeKey(code), JSON.stringify(room), {
      onlyIf: { etagDoesNotMatch: "*" },
    });
    if (saved) return json({ ...room, generation: generation(room) }, 201);
    if (requested) return error("This room code is taken. Choose another code.", 409);
  }
  return error("Could not generate a room code. Try again.", 503);
}

function roomLink(value) {
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
      return url.href.length <= 2048 ? url.href : null;
    }
  } catch {}
  return null;
}

async function addRoomPost(request, bucket, key, roomKey, room) {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const kind = form.get("kind");
  if (!POST_KINDS.includes(kind)) return error("Choose Text, Links, Images, or Files.", 400);
  let value = form.get("value") ?? "";
  if (typeof value !== "string") {
    if (value.size > 150000) return error("Use up to 50,000 characters.", 400);
    value = await value.text();
  }
  const files = form.getAll("file");
  if (files.length > FILE_COUNT_LIMIT || files.some(file => typeof file === "string")) {
    return error("Add up to eight files per post.", 400);
  }
  const attachmentPost = kind === "images" || kind === "files";
  if (attachmentPost && !files.length) return error("Add at least one attachment.", 400);
  if (!attachmentPost && (!value.trim() || files.length)) return error("Enter content for this post type.", 400);
  if (kind === "text" && value.length > 50000) return error("Use up to 50,000 characters.", 400);
  if (kind === "links") {
    value = value.length <= 2048 ? roomLink(value.trim()) : null;
    if (!value) return error("Enter a complete http or https link.", 400);
  }

  const { attachments, total } = describeFiles(files);
  if (total > FILE_LIMIT) return error("Attachments can total up to 10 MB per post.", 413);
  if (kind === "images" && attachments.some(file => !IMAGE_TYPES.has(file.type))) {
    return error("Use PNG, JPEG, WebP, GIF, AVIF, or BMP for an image post.", 400);
  }

  const sensitive = form.get("sensitive") === "true";
  const owner = sensitive ? await browserIdentity(request) : null;
  if (sensitive && (!owner || attachments.length > 1)) return error("Sensitive posts support text, a link, or a single attachment.", 400);
  const createdAt = Date.now();
  const expiresAt = sensitive ? createdAt + 60_000 : null;
  const id = String(9_999_999_999_999 - createdAt).padStart(13, "0") + "-" + crypto.randomUUID();
  const metadata = encoder.encode(JSON.stringify({ value: attachmentPost ? "" : value, attachments }));
  const summary = sensitive ? "Sensitive post" : attachmentPost ? attachments[0].name :
    kind === "links" ? value.slice(0, 180) : value.trim().slice(0, 180);
  const postKey = key + "/posts/" + kind + "/" + id;
  const stored = await bucket.put(postKey, new Blob([metadata, ...files]), {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { kind, createdAt: String(createdAt), summary, count: String(attachments.length), metadataSize: String(metadata.length),
      ...(sensitive ? { owner, expiresAt: String(expiresAt), ...(attachments[0] ? { filename: attachments[0].name } : {}) } : {}) },
  });
  if (!stored) return error("Could not save the post. Try again.", 503);
  const latest = await bucket.get(roomKey);
  if (!latest || generation(await latest.json()) !== generation(room)) {
    await bucket.delete(postKey);
    return error("This room was cleared.", 410);
  }
  return json({ id, kind, summary, count: attachments.length, createdAt, expiresAt }, 201);
}

async function listRoomPosts(request, bucket, key, params, context) {
  const kind = params.get("kind") || "all";
  const after = params.get("after");
  if (kind !== "all" && !POST_KINDS.includes(kind)) return error("Choose a supported post type.", 400);
  if (after && !POST_ID.test(after)) return error("This page is no longer valid. Refresh the room.", 400);
  const groups = await Promise.all((kind === "all" ? POST_KINDS : [kind]).map(postKind => {
    const prefix = key + "/posts/" + postKind + "/";
    return bucket.list({ prefix, startAfter: after ? prefix + after : undefined,
      limit: PAGE_SIZE + 1, include: ["customMetadata"] });
  }));
  const now = Date.now();
  const owner = await browserIdentity(request);
  const expired = [];
  const entries = groups.flatMap(group => group.objects.map(post => {
    const metadata = post.customMetadata ?? {};
    const expiresAt = postExpiry(metadata);
    if (expiresAt && expiresAt <= now) expired.push(post.key);
    const id = post.key.slice(post.key.lastIndexOf("/") + 1);
    if (metadata.retired || (expiresAt && expiresAt <= now)) return { id, removed: true };
    return { id, kind: metadata.kind, summary: metadata.summary, createdAt: Number(metadata.createdAt), count: Number(metadata.count),
      ...(expiresAt ? { expiresAt, own: metadata.owner === owner, filename: metadata.filename } : {}) };
  }));
  if (expired.length) context.waitUntil(bucket.delete(expired).catch(() => {}));
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const page = entries.slice(0, PAGE_SIZE);
  const more = entries.length > PAGE_SIZE || groups.some(group => group.truncated);
  return json({ posts: page.filter(post => !post.removed), next: more ? page.at(-1)?.id ?? null : null });
}

async function readRoomPost(request, bucket, context, key, kind, id, fileIndex, mode) {
  const postKey = key + "/posts/" + kind + "/" + id;
  const post = await bucket.head(postKey);
  if (!post || post.customMetadata.retired) return error("Post not found in this room.", 404);
  const { expiresAt, metadataSize } = post.customMetadata;
  if (expiresAt) {
    if (Number(expiresAt) <= Date.now()) {
      context.waitUntil(bucket.delete(postKey).catch(() => {}));
      return error("This post has expired.", 404);
    }
    if (mode !== "claim") return error("Open this post using its one-time claim.", 403);
  }
  const onlyIf = { etagMatches: post.etag };
  const stored = await bucket.get(postKey, { onlyIf, range: { offset: 0, length: Number(metadataSize) } });
  if (!stored?.body) return error("Post not found in this room.", 404);
  const body = await stored.json();
  if (mode === "claim") return claimRoomPost(request, bucket, context, postKey, post, post.customMetadata, body);
  const { value, attachments } = body;
  if (fileIndex !== undefined) {
    const file = attachments[Number(fileIndex)];
    if (mode === "stream" && file && MEDIA_TYPES.test(file.type)) return streamRoomMedia(request, bucket, postKey, post, file);
    return serveAttachment(bucket, postKey, Number(metadataSize), file, mode === "preview", onlyIf);
  }
  return json({ id, kind, value, createdAt: Number(post.customMetadata.createdAt),
    attachments: attachments.map(({ name, type, size }) => ({ name, type, size })) });
}

async function handleRooms(request, bucket, url, context) {
  const { pathname, searchParams } = url;
  const method = request.method;
  if (pathname === "/api/rooms" && method === "POST") return createRoom(request, bucket);
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.*))?$/);
  if (!match) return error("Page not found.", 404);
  const [, code, route = ""] = match;
  if (!CODE_PATTERN.test(code)) return error(CODE_HELP, 400);
  const post = route.match(/^posts\/(text|links|images|files)\/(\d{13}-[a-f0-9-]{36})(?:\/files\/(\d+)|(\/claim))?$/);
  if (post && !POST_ID.test(post[2])) return error("Post not found in this room.", 404);
  const workspace = route === "pad" || route === "reset";
  const screen = route === "presence" || route === "signal";
  const validPostMethod = post && (post[4] ? method === "POST" : method === "GET");
  if (!workspace && !screen && !validPostMethod && !(route === "posts" && (method === "GET" || method === "POST")) &&
    !(route === "" && method === "GET")) return error("Room codes are permanent.", 405);

  const key = "rooms/" + codeKey(code.toUpperCase());
  const object = await bucket.get(key);
  if (!object) return error("Room not found. Check the room code.", 404);
  const room = await object.json();
  const expected = request.headers.get("X-Room-Generation");
  if (expected && expected !== generation(room)) return error("This room was cleared. Join it again to continue.", 410);
  const partition = roomPartition(key, room);
  if (screen) return handleScreen(request, bucket, context, partition, route);
  if (workspace) return handleWorkspace(request, bucket, context, key, object, room, partition, route);
  if (post) return readRoomPost(request, bucket, context, partition, post[1], post[2], post[3],
    post[4] ? "claim" : searchParams.has("stream") ? "stream" : searchParams.has("preview") ? "preview" : "download");
  if (route === "posts") return method === "POST" ? addRoomPost(request, bucket, partition, key, room) :
    listRoomPosts(request, bucket, partition, searchParams, context);
  return json({ ...room, generation: generation(room) });
}
