const FILE_LIMIT = 10_000_000;
const REQUEST_LIMIT = FILE_LIMIT + 300_000;
const FILE_COUNT_LIMIT = 8;
const CODE_PATTERN = /^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const EXPIRATIONS = new Set([3600, 86400, 604800]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"]);
const encoder = new TextEncoder();

const policy = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: policy });
}

function error(message, status) {
  return json({ error: message }, status);
}

function shareCode() {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => ALPHABET[byte & 31]);
  return chars.slice(0, 4).join("") + "-" + chars.slice(4).join("");
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readForm(request) {
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) {
    return error("Use the clipboard form to upload a clip.", 415);
  }
  if (Number(request.headers.get("Content-Length")) > REQUEST_LIMIT) {
    return error("Attachments can total up to 10 MB.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return error("The upload was empty.", 400);
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REQUEST_LIMIT) {
      await reader.cancel();
      return error("Attachments can total up to 10 MB.", 413);
    }
    parts.push(value);
  }
  try {
    return await new Response(new Blob(parts), {
      headers: { "Content-Type": request.headers.get("Content-Type") },
    }).formData();
  } catch {
    return error("The upload could not be read. Try adding the files again.", 400);
  }
}

async function cleanExpired(bucket, now) {
  const prefix = "clips/";
  const page = await bucket.list({
    prefix, startAfter: prefix + shareCode(), limit: 30, include: ["customMetadata"],
  });
  const expired = page.objects.filter(object => Number(object.customMetadata?.expiresAt) <= now);
  if (expired.length) await bucket.delete(expired.map(object => object.key));
}

async function createClip(request, bucket, context) {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const text = form.get("text") ?? "";
  const duration = Number(form.get("expiry"));
  const files = form.getAll("file");
  if (typeof text !== "string" || text.length > 50000) return error("Text can contain up to 50,000 characters.", 400);
  if (!EXPIRATIONS.has(duration)) return error("Choose an expiration time.", 400);
  if (!text.trim() && !files.length) return error("Add some text or attach a file to create a clip.", 400);
  if (files.length > FILE_COUNT_LIMIT || files.some(file => typeof file === "string")) {
    return error("Add up to eight files per clip.", 400);
  }

  let total = 0;
  const attachments = files.map(file => {
    const attachment = {
      name: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "Attachment",
      type: IMAGE_TYPES.has(file.type) ? file.type : "application/octet-stream",
      size: file.size, offset: total,
    };
    total += file.size;
    return attachment;
  });
  if (total > FILE_LIMIT) return error("Attachments can total up to 10 MB.", 413);

  const createdAt = Date.now();
  const expiresAt = createdAt + duration * 1000;
  const deleteToken = randomToken();
  const deleteHash = await tokenHash(deleteToken);
  const metadata = encoder.encode(JSON.stringify({ text, attachments, expiresAt }));
  const object = new Blob([metadata, ...files]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = shareCode();
    const saved = await bucket.put("clips/" + code, object, {
      onlyIf: { etagDoesNotMatch: "*" },
      customMetadata: { metadataSize: String(metadata.byteLength), expiresAt: String(expiresAt), deleteHash },
    });
    if (saved) {
      context.waitUntil(cleanExpired(bucket, createdAt).catch(() => {}));
      return json({ code, expiresAt, deleteToken }, 201);
    }
  }
  return error("Could not generate a code. Try again.", 503);
}

async function openClip(request, bucket, context, code, fileIndex, preview) {
  const key = "clips/" + code;
  const object = await bucket.head(key);
  if (!object) return error("Clip not found or expired. Check the share code.", 404);
  const { expiresAt, metadataSize, deleteHash } = object.customMetadata;
  if (Number(expiresAt) <= Date.now()) {
    context.waitUntil(bucket.delete(key).catch(() => {}));
    return error("This clip has expired.", 404);
  }
  if (request.method === "DELETE") {
    const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
    if (!token || await tokenHash(token) !== deleteHash) return error("Only the creator can delete this clip.", 403);
    await bucket.delete(key);
    return new Response(null, { status: 204, headers: policy });
  }
  const metadataObject = await bucket.get(key, { range: { offset: 0, length: Number(metadataSize) } });
  if (!metadataObject) return error("Clip not found or expired.", 404);
  const metadata = await metadataObject.json();

  if (fileIndex === undefined) {
    const attachments = metadata.attachments.map(({ name, type, size }) => ({ name, type, size }));
    return json({ code, text: metadata.text, expiresAt: metadata.expiresAt, attachments });
  }

  const file = metadata.attachments[Number(fileIndex)];
  if (!file || (preview && !IMAGE_TYPES.has(file.type))) return error("Attachment not found.", 404);
  const content = file.size ? await bucket.get(key, {
    range: { offset: Number(metadataSize) + file.offset, length: file.size },
  }) : null;
  if (file.size && !content) return error("Attachment not found.", 404);
  const encodedName = encodeURIComponent(file.name.toWellFormed()).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
  return new Response(content?.body ?? null, { headers: {
    ...policy,
    "Content-Type": preview ? file.type : "application/octet-stream",
    "Content-Length": String(file.size),
    "Content-Disposition": preview ? "inline" : "attachment; filename*=UTF-8''" + encodedName,
  } });
}

export function makeWorker(assets) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      const { pathname, origin } = url;
      const method = request.method;
      if ((method === "GET" || method === "HEAD") && Object.hasOwn(assets, pathname)) {
        const [type, body] = assets[pathname];
        return new Response(method === "HEAD" ? null : body, { headers: { ...policy, "Content-Type": type } });
      }
      if (!pathname.startsWith("/api/")) return error("Page not found.", 404);
      const isMutation = method === "POST" || method === "DELETE";
      const requester = request.headers.get("Origin");
      if (isMutation && requester && requester !== origin) return error("Open Clipdrop to make changes.", 403);
      if (!env.BUCKET) return error("Shared storage is currently unavailable.", 503);
      try {
        if (method === "POST" && pathname === "/api/clips") return await createClip(request, env.BUCKET, context);
        const match = pathname.match(/^\/api\/clips\/([^/]+)(?:\/files\/(\d+))?$/);
        if (!match || (method !== "GET" && !(method === "DELETE" && !match[2]))) return error("Page not found.", 404);
        if (!CODE_PATTERN.test(match[1])) return error("Enter an eight-character share code.", 400);
        return await openClip(request, env.BUCKET, context, match[1], match[2], url.searchParams.has("preview"));
      } catch {
        return error("The clipboard service is temporarily unavailable. Try again in a moment.", 503);
      }
    },
  };
}
