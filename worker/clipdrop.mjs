const FILE_LIMIT = 100_000_000;
const REQUEST_LIMIT = FILE_LIMIT + 500_000;
const FILE_COUNT_LIMIT = 50;
const FILE_INDEX_LIMIT = FILE_COUNT_LIMIT - 1; // max valid file index (0-based)
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/i;
const COMPACT_GENERATED = /^[23456789A-HJ-NP-Z]{8}$/;
const CODE_HELP = "Use 4–24 letters, numbers, or hyphens. Start and end with a letter or number.";
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const EXPIRATIONS = new Set([3600, 86400, 604800]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp"]);
const MEDIA_TYPES = /^(?:audio\/(?:mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|video\/(?:mp4|webm|ogg|quicktime))$/;
const encoder = new TextEncoder();

const policy = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
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

function codeKey(code) {
  return COMPACT_GENERATED.test(code) ? code.slice(0, 4) + "-" + code.slice(4) : code;
}

function requestedCode(form) {
  const value = form.get("code") ?? "";
  if (typeof value !== "string") return null;
  const code = value.trim();
  return !code || CODE_PATTERN.test(code) ? code.toUpperCase() : null;
}

async function reserveCode(bucket, displayCode, body, customMetadata) {
  const key = "clips/" + codeKey(displayCode);
  const metadata = { ...customMetadata, displayCode };
  const reserved = await bucket.put(key, body, {
    onlyIf: { etagDoesNotMatch: "*" }, customMetadata: metadata,
  });
  if (reserved) return true;
  const previous = await bucket.head(key);
  if (!previous || Number(previous.customMetadata.expiresAt) > Date.now()) return false;
  const replaced = await bucket.put(key, body, {
    onlyIf: { etagMatches: previous.etag }, customMetadata: metadata,
  });
  if (replaced && previous.customMetadata.metadataSize) {
    await bucket.delete("state/" + previous.customMetadata.deleteHash).catch(() => {});
  }
  return Boolean(replaced);
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readForm(request, limit = REQUEST_LIMIT) {
  const limitMessage = limit === REQUEST_LIMIT ? "Attachments can total up to 10 MB." : "This form is too large.";
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) {
    return error("Use the clipboard form to upload a clip.", 415);
  }
  if (Number(request.headers.get("Content-Length")) > limit) {
    return error(limitMessage, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return error("The upload was empty.", 400);
  const parts = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return error(limitMessage, 413);
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

// Conditionally replace expired payloads with tiny markers so a late cleanup cannot erase a reused code.
async function retirePayload(bucket, object) {
  const { deleteHash } = object.customMetadata;
  const retired = await bucket.put(object.key, deleteHash, {
    onlyIf: { etagMatches: object.etag }, customMetadata: { expiresAt: "0" },
  });
  if (retired) await bucket.delete("state/" + deleteHash);
}

async function cleanExpired(bucket, now) {
  const prefix = "clips/";
  const startAfter = Math.random() < 0.25 ? undefined : prefix + shareCode();
  const page = await bucket.list({ prefix, startAfter, limit: 30, include: ["customMetadata"] });
  const expired = page.objects.filter(object => object.customMetadata?.metadataSize &&
    Number(object.customMetadata.expiresAt) <= now);
  await Promise.all(expired.map(object => retirePayload(bucket, object)));
}

function describeFiles(files) {
  let total = 0;
  const attachments = files.map(file => {
    const attachment = {
      name: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 180) || "Attachment",
      type: IMAGE_TYPES.has(file.type) || MEDIA_TYPES.test(file.type) ? file.type : "application/octet-stream",
      size: file.size, offset: total,
    };
    total += file.size;
    return attachment;
  });
  return { attachments, total };
}

async function createClip(request, bucket, context) {
  const form = await readForm(request);
  if (form instanceof Response) return form;
  const content = form.get("text") ?? "";
  if (typeof content !== "string" || content.size > 150000) {
    return error("Text can contain up to 50,000 characters.", 400);
  }
  const text = typeof content === "string" ? content : await content.text();
  const duration = Number(form.get("expiry"));
  const customCode = requestedCode(form);
  if (customCode === null) return error(CODE_HELP, 400);
  const files = form.getAll("file");
  if (typeof text !== "string" || text.length > 50000) return error("Text can contain up to 50,000 characters.", 400);
  if (!EXPIRATIONS.has(duration)) return error("Choose an expiration time.", 400);
  if (!text.trim() && !files.length) return error("Add some text or attach a file to create a clip.", 400);
  if (files.length > FILE_COUNT_LIMIT || files.some(file => typeof file === "string")) {
    return error("Add up to eight files per clip.", 400);
  }

  const { attachments, total } = describeFiles(files);
  if (total > FILE_LIMIT) return error("Attachments can total up to 100 MB.", 413);

  const createdAt = Date.now();
  const expiresAt = createdAt + duration * 1000;
  const deleteToken = randomToken();
  const deleteHash = await tokenHash(deleteToken);
  const metadata = encoder.encode(JSON.stringify({ text, attachments, expiresAt, deleteHash }));
  const object = new Blob([metadata, ...files]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = customCode || shareCode();
    if (await reserveCode(bucket, code, object, {
      metadataSize: String(metadata.byteLength), expiresAt: String(expiresAt), deleteHash,
    })) {
      context.waitUntil(cleanExpired(bucket, createdAt).catch(() => {}));
      return json({ code, expiresAt, deleteToken }, 201);
    }
    if (customCode) return error("That code is already in use. Try another one.", 409);
  }
  return error("Could not generate a code. Try again.", 503);
}

async function setActiveCode(bucket, stateKey, previous, code) {
  return bucket.put(stateKey, JSON.stringify({ code }), {
    onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" },
  });
}

async function openClip(request, bucket, context, code, fileIndex, preview) {
  const locator = await bucket.head("clips/" + code);
  const missing = () => error("Clip not found or expired. Check the share code.", 404);
  if (!locator) return missing();
  const rootCode = locator.customMetadata.rootCode ?? code;
  const key = "clips/" + rootCode;
  const root = rootCode === code ? locator : await bucket.head(key);
  if (!root || root.customMetadata.deleteHash !== locator.customMetadata.deleteHash || !root.customMetadata.metadataSize) {
    return missing();
  }
  const { expiresAt, metadataSize, deleteHash } = root.customMetadata;
  if (Number(expiresAt) <= Date.now()) {
    context.waitUntil(retirePayload(bucket, root).catch(() => {}));
    return error("This clip has expired.", 404);
  }

  const stateKey = "state/" + deleteHash;
  const state = await bucket.get(stateKey);
  const active = state ? (await state.json()).code : rootCode;
  if (active !== code) return missing();

  if (request.method !== "GET") {
    const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
    if (!token || await tokenHash(token) !== deleteHash) return error("Only the creator can delete this clip.", 403);
    if (!await setActiveCode(bucket, stateKey, state, null)) {
      return error("This clip changed while you were deleting it. Try again.", 409);
    }
    await retirePayload(bucket, root);
    return new Response(null, { status: 204, headers: policy });
  }

  const onlyIf = { etagMatches: root.etag };
  const metadataObject = await bucket.get(key, { onlyIf, range: { offset: 0, length: Number(metadataSize) } });
  if (!metadataObject?.body) return missing();
  const metadata = await metadataObject.json();

  if (fileIndex === undefined) {
    const attachments = metadata.attachments.map(({ name, type, size }) => ({ name, type, size }));
    return json({ code: locator.customMetadata.displayCode ?? code, text: metadata.text, expiresAt: metadata.expiresAt, attachments });
  }

  return serveAttachment(bucket, key, Number(metadataSize), metadata.attachments[Number(fileIndex)], preview, onlyIf);
}

async function serveAttachment(bucket, key, metadataSize, file, preview, onlyIf) {
  if (!file || (preview && !IMAGE_TYPES.has(file.type))) return error("Attachment not found.", 404);
  const content = file.size ? await bucket.get(key, {
    ...(onlyIf ? { onlyIf } : {}), range: { offset: metadataSize + file.offset, length: file.size },
  }) : null;
  if (file.size && !content?.body) return error("Attachment not found.", 404);
  const encodedName = encodeURIComponent(file.name.toWellFormed()).replace(/['()*]/g, char => "%" + char.charCodeAt(0).toString(16));
  return new Response(content?.body ?? null, { headers: {
    ...policy,
    "Content-Type": preview ? file.type : "application/octet-stream",
    "Content-Length": String(file.size),
    "Content-Disposition": preview ? "inline" : "attachment; filename*=UTF-8''" + encodedName,
  } });
}

export function makeWorker(assets) {
  const binary = new Map();
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      const { pathname, origin } = url;
      const method = request.method;
      if (method === "GET" && pathname === "/api/health") {
        if (!env.BUCKET) return error("Room storage has not been configured for this deployment.", 503);
        return json({ status: "ok" });
      }
      if ((method === "GET" || method === "HEAD") && Object.hasOwn(assets, pathname)) {
        const [type, source, encoding] = assets[pathname];
        // Security headers are inherited from `policy`; binary assets additionally get a cache directive.
        // Critically: do NOT remove Cache-Control from policy (it's "no-store"), instead merge carefully.
        const headers = { ...policy, "Content-Type": type };
        if (encoding === "base64") {
          // Allow browser caching for immutable binary assets (fonts, etc.) while keeping other security headers
          headers["Cache-Control"] = "public, max-age=86400, immutable";
        }
        if (method === "HEAD") return new Response(null, { headers });
        if (encoding !== "base64") return new Response(source, { headers });
        if (!binary.has(pathname)) binary.set(pathname, Uint8Array.from(atob(source), byte => byte.charCodeAt(0)));
        return new Response(binary.get(pathname), { headers });
      }
      if (!pathname.startsWith("/api/")) return error("Page not found.", 404);
      const isTypeQueue = /^\/api\/rooms\/[^/]+\/type-queue(?:\/[^/]+\/claim|\/[^/]+)?$/.test(pathname);
      const requester = request.headers.get("Origin");
      if (isTypeQueue && method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...policy,
            "Access-Control-Allow-Origin": requester || "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Room-Generation, X-Clipdrop-Client",
            "Access-Control-Max-Age": "600",
          },
        });
      }
      const isMutation = method !== "GET" && method !== "HEAD";
      const isExtensionOrigin = requester?.startsWith("chrome-extension://") || requester?.startsWith("moz-extension://");
      const trustedWebOrigin = typeof env.CLIPDROP_WEB_ORIGINS === "string" &&
        env.CLIPDROP_WEB_ORIGINS.split(",").some(value => value.trim() === requester);
      if (isMutation && requester && requester !== origin && !trustedWebOrigin && !(isTypeQueue && isExtensionOrigin) && !isTypeQueue) {
        return error("Open Clipdrop to make changes.", 403);
      }
      if (!env.BUCKET) return error("Shared storage is currently unavailable.", 503);
      try {
        if (pathname === "/api/rooms" || pathname.startsWith("/api/rooms/")) {
          const response = await handleRooms(request, env.BUCKET, url, context);
          if (isTypeQueue && requester) {
            const headers = new Headers(response.headers);
            headers.set("Access-Control-Allow-Origin", requester);
            headers.set("Vary", "Origin");
            return new Response(response.body, { status: response.status, headers });
          }
          return response;
        }
        if (method === "POST" && pathname === "/api/clips") return await createClip(request, env.BUCKET, context);
        const match = pathname.match(/^\/api\/clips\/([^/]+)(?:\/files\/(\d{1,2}))?$/);
        if (!match || (method !== "GET" && !(method === "DELETE" && !match[2]))) return error("Page not found.", 404);
        if (!CODE_PATTERN.test(match[1])) return error(CODE_HELP, 400);
        const fileIdx = match[2] !== undefined ? Number(match[2]) : undefined;
        if (fileIdx !== undefined && fileIdx > FILE_INDEX_LIMIT) return error("Attachment not found.", 404);
        const code = codeKey(match[1].toUpperCase());
        return await openClip(request, env.BUCKET, context, code, match[2], url.searchParams.has("preview"));
      } catch {
        return error("The clipboard service is temporarily unavailable. Try again in a moment.", 503);
      }
    },
  };
}
