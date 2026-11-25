import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

function safePath(value) {
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[:\\\x00-\x1f]/.test(part))) {
    throw new Error('A folder entry has an invalid path.');
  }
  return parts.join('/');
}

export function directoryFiles(files) {
  return [...files].map(file => ({ file, path: file.webkitRelativePath || file.name }));
}

async function walk(entry, prefix, result) {
  if (result.length >= 10000) throw new Error('A folder can contain up to 10,000 entries.');
  const path = prefix ? prefix + '/' + entry.name : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    result.push({ file, path });
  } else if (entry.isDirectory) {
    result.push({ path });
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const item of batch) await walk(item, path, result);
    }
  }
}

export async function readDrop(transfer) {
  const entries = [...transfer.items].map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const fallback = directoryFiles(transfer.files);
  if (!entries.some(entry => entry.isDirectory)) return { folder: false, entries: fallback };
  const result = [];
  for (const entry of entries) await walk(entry, '', result);
  return { folder: true, entries: result };
}

export async function zipFolder(entries, limit, name = 'folder.zip') {
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
  if (inputSize > limit) throw new Error('The folder exceeds the host’s file limit before compression.');

  const chunks = [];
  let size = 0;
  let failure;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if ((size += chunk.length) > limit) failure = new Error('The ZIP exceeds the host’s file limit.');
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
