import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

function safePath(value) {
  const normalized = value.replace(/\\+/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) {
    throw new Error('A folder entry has an invalid path.');
  }
  return parts.join('/');
}

export async function zipFolder(entries, limit = 100_000_000, name = 'folder.zip') {
  if (!entries.length) throw new Error('Choose a folder with contents.');
  if (entries.length > 10000) throw new Error('A folder can contain up to 10,000 entries.');
  const names = new Set();
  let inputSize = 0;
  const sources = entries.map(({ path, file }) => {
    const key = safePath(path) + (file ? '' : '/');
    if (names.has(key)) throw new Error('The folder contains duplicate paths.');
    names.add(key);
    inputSize += file?.size ?? 0;
    return { key, file };
  });
  if (inputSize > 100_000_000) throw new Error('The folder exceeds 100 MB before compression.');

  const chunks = [];
  let size = 0;
  let failure;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if ((size += chunk.length) > limit) failure = new Error('The ZIP exceeds 100 MB.');
    else chunks.push(chunk);
  });
  try {
    for (const { key, file } of sources) {
      const part = file ? new ZipDeflate(key, { level: 6 }) : new ZipPassThrough(key);
      zip.add(part);
      if (file) {
        const reader = file.stream().getReader();
        let complete = false;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) { complete = true; break; }
            part.push(value);
            if (failure) throw failure;
          }
        } finally {
          if (!complete) await reader.cancel();
          reader.releaseLock();
        }
      }
      part.push(new Uint8Array(), true);
      if (failure) throw failure;
    }
    zip.end();
    if (failure) throw failure;
    return new File(chunks, name, { type: 'application/zip' });
  } finally {
    zip.terminate();
  }
}
