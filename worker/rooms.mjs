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
    if (saved) return json(room, 201);
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

async function addRoomPost(request, bucket, key) {
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

  const createdAt = Date.now();
  const id = String(9_999_999_999_999 - createdAt).padStart(13, "0") + "-" + crypto.randomUUID();
  const metadata = encoder.encode(JSON.stringify({ value: attachmentPost ? "" : value, attachments }));
  const summary = attachmentPost ? attachments[0].name :
    kind === "links" ? value.slice(0, 180) : value.trim().slice(0, 180);
  const stored = await bucket.put(key + "/posts/" + kind + "/" + id, new Blob([metadata, ...files]), {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { kind, createdAt: String(createdAt), summary, count: String(attachments.length), metadataSize: String(metadata.length) },
  });
  if (!stored) return error("Could not save the post. Try again.", 503);
  return json({ id, kind, summary, count: attachments.length, createdAt }, 201);
}

async function listRoomPosts(bucket, key, params) {
  const kind = params.get("kind") || "all";
  const after = params.get("after");
  if (kind !== "all" && !POST_KINDS.includes(kind)) return error("Choose a supported post type.", 400);
  if (after && !POST_ID.test(after)) return error("This page is no longer valid. Refresh the room.", 400);
  const groups = await Promise.all((kind === "all" ? POST_KINDS : [kind]).map(postKind => {
    const prefix = key + "/posts/" + postKind + "/";
    return bucket.list({ prefix, startAfter: after ? prefix + after : undefined,
      limit: PAGE_SIZE + 1, include: ["customMetadata"] });
  }));
  const entries = groups.flatMap(group => group.objects.map(post => {
    const { kind, createdAt, summary, count } = post.customMetadata;
    return { id: post.key.slice(post.key.lastIndexOf("/") + 1), kind, summary, createdAt: Number(createdAt), count: Number(count) };
  }));
  entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const posts = entries.slice(0, PAGE_SIZE);
  const more = entries.length > PAGE_SIZE || groups.some(group => group.truncated);
  return json({ posts, next: more ? posts.at(-1)?.id ?? null : null });
}

async function readRoomPost(bucket, key, kind, id, fileIndex, preview) {
  const postKey = key + "/posts/" + kind + "/" + id;
  const post = await bucket.head(postKey);
  if (!post) return error("Post not found in this room.", 404);
  const metadataSize = Number(post.customMetadata.metadataSize);
  const stored = await bucket.get(postKey, { range: { offset: 0, length: metadataSize } });
  if (!stored) return error("Post not found in this room.", 404);
  const { value, attachments } = await stored.json();
  if (fileIndex !== undefined) {
    return serveAttachment(bucket, postKey, metadataSize, attachments[Number(fileIndex)], preview);
  }
  return json({ id, kind, value, createdAt: Number(post.customMetadata.createdAt),
    attachments: attachments.map(({ name, type, size }) => ({ name, type, size })) });
}

async function handleRooms(request, bucket, url) {
  const { pathname, searchParams } = url;
  const method = request.method;
  if (pathname === "/api/rooms" && method === "POST") return createRoom(request, bucket);
  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(posts)(?:\/(text|links|images|files)\/(\d{13}-[a-f0-9-]{36})(?:\/files\/(\d+))?)?)?$/);
  if (!match) return error("Page not found.", 404);
  const [, code, collection, kind, id, fileIndex] = match;
  if (!CODE_PATTERN.test(code)) return error(CODE_HELP, 400);
  if (id && !POST_ID.test(id)) return error("Post not found in this room.", 404);
  if (method !== "GET" && !(method === "POST" && collection)) return error("Room codes are permanent.", 405);

  const key = "rooms/" + codeKey(code.toUpperCase());
  const room = collection ? await bucket.head(key) : await bucket.get(key);
  if (!room) return error("Room not found. Check the room code.", 404);
  if (id) return readRoomPost(bucket, key, kind, id, fileIndex, searchParams.has("preview"));
  if (collection) {
    return method === "POST" ? addRoomPost(request, bucket, key) : listRoomPosts(bucket, key, searchParams);
  }
  return json(await room.json());
}
