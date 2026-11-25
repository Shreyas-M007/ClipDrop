import { zipSync } from "fflate";

const IMAGE_TARGETS = [
  { id: "png", label: "PNG (.png)", mime: "image/png", ext: "png" },
  { id: "jpeg", label: "JPEG (.jpg)", mime: "image/jpeg", ext: "jpg" },
  { id: "webp", label: "WebP (.webp)", mime: "image/webp", ext: "webp" },
  { id: "pdf", label: "PDF (.pdf)", mime: "application/pdf", ext: "pdf" },
];

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "html", "htm", "xml",
  "yaml", "yml", "js", "ts", "jsx", "tsx", "py", "css", "sql", "sh", "log", "svg",
]);

function fileExt(name = "") {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function baseName(name = "file") {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function isImage(file) {
  const ext = fileExt(file.name);
  return file.type?.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"].includes(ext);
}

function isAudio(file) {
  const ext = fileExt(file.name);
  return file.type?.startsWith("audio/") || ["mp3", "wav", "ogg", "webm", "m4a", "aac", "flac"].includes(ext);
}

function isTextLike(file) {
  const ext = fileExt(file.name);
  return file.type?.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    TEXT_EXTENSIONS.has(ext);
}

export function getConversionTargets(file) {
  const ext = fileExt(file.name);
  if (isImage(file)) {
    return IMAGE_TARGETS.filter(t => !(t.ext === ext || (t.ext === "jpg" && ext === "jpeg")));
  }
  if (ext === "json") {
    return [
      { id: "csv", label: "CSV (.csv)", mime: "text/csv;charset=utf-8", ext: "csv" },
      { id: "tsv", label: "TSV (.tsv)", mime: "text/tab-separated-values;charset=utf-8", ext: "tsv" },
      { id: "txt", label: "Text (.txt)", mime: "text/plain;charset=utf-8", ext: "txt" },
      { id: "pdf", label: "PDF (.pdf)", mime: "application/pdf", ext: "pdf" },
    ];
  }
  if (ext === "csv" || ext === "tsv") {
    return [
      { id: "json", label: "JSON (.json)", mime: "application/json;charset=utf-8", ext: "json" },
      { id: ext === "csv" ? "tsv" : "csv", label: ext === "csv" ? "TSV (.tsv)" : "CSV (.csv)", mime: "text/plain;charset=utf-8", ext: ext === "csv" ? "tsv" : "csv" },
      { id: "html", label: "HTML table (.html)", mime: "text/html;charset=utf-8", ext: "html" },
      { id: "pdf", label: "PDF (.pdf)", mime: "application/pdf", ext: "pdf" },
    ];
  }
  if (isTextLike(file)) {
    const targets = [
      { id: "txt", label: "Plain Text (.txt)", mime: "text/plain;charset=utf-8", ext: "txt" },
      { id: "html", label: "HTML (.html)", mime: "text/html;charset=utf-8", ext: "html" },
      { id: "json", label: "JSON (.json)", mime: "application/json;charset=utf-8", ext: "json" },
      { id: "pdf", label: "PDF (.pdf)", mime: "application/pdf", ext: "pdf" },
      { id: "zip", label: "ZIP (.zip)", mime: "application/zip", ext: "zip" },
    ];
    return targets.filter(t => t.ext !== ext);
  }
  if (isAudio(file)) {
    return [
      ...(ext !== "wav" ? [{ id: "wav", label: "WAV (.wav)", mime: "audio/wav", ext: "wav" }] : []),
      { id: "zip", label: "ZIP (.zip)", mime: "application/zip", ext: "zip" },
      { id: "b64", label: "Base64 (.txt)", mime: "text/plain;charset=utf-8", ext: "b64.txt" },
    ];
  }
  return [
    { id: "zip", label: "ZIP (.zip)", mime: "application/zip", ext: "zip" },
    { id: "b64", label: "Base64 (.txt)", mime: "text/plain;charset=utf-8", ext: "b64.txt" },
  ];
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean) || rows.length) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function toDelimited(rows, delimiter) {
  return rows.map(row => row.map(val => {
    const str = val == null ? "" : String(val);
    return str.includes(delimiter) || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  }).join(delimiter)).join("\n");
}

function buildTextPdf(text) {
  const lines = [];
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const safe = rawLine.replace(/[^\x20-\x7E]/g, "?");
    for (let i = 0; i < safe.length || i === 0; i += 86) {
      lines.push(safe.slice(i, i + 86));
    }
  }
  const pages = [];
  for (let i = 0; i < lines.length || i === 0; i += 48) {
    pages.push(lines.slice(i, i + 48));
  }
  const objects = [];
  const addObj = body => { objects.push(body); return objects.length; };
  const fontId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds = [];
  const pagesPlaceholder = addObj("");
  for (const chunk of pages) {
    const ops = ["BT", "/F1 10 Tf", "40 752 Td", "14 TL"];
    for (const line of chunk) {
      ops.push(`(${line.replace(/[\\()]/g, m => "\\" + m)}) Tj T*`);
    }
    ops.push("ET");
    const stream = ops.join("\n");
    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(addObj(`<< /Type /Page /Parent ${pagesPlaceholder} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[pagesPlaceholder - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesPlaceholder} 0 R >>`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function buildImagePdf(jpegBytes, width, height) {
  const maxW = 540;
  const maxH = 720;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const drawW = Math.round(width * scale);
  const drawH = Math.round(height * scale);
  const x = Math.round((612 - drawW) / 2);
  const y = Math.round((792 - drawH) / 2);
  const stream = `q\n${drawW} 0 0 ${drawH} ${x} ${y} cm\n/Im1 Do\nQ`;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let len = 0;
  const push = s => { const b = typeof s === "string" ? enc.encode(s) : s; parts.push(b); len += b.byteLength; };
  push("%PDF-1.4\n");
  const objs = [
    () => push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    () => push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    () => push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"),
    () => {
      push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`);
      push(jpegBytes);
      push("\nendstream\nendobj\n");
    },
    () => push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`),
  ];
  for (const write of objs) {
    offsets.push(len);
    write();
  }
  const xref = len;
  push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (let i = 1; i < offsets.length; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}

async function renderImageToCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Could not decode image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeWav(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const buffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * numChannels * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function convertBlob(blob, file, targetId) {
  const target = getConversionTargets(file).find(t => t.id === targetId);
  if (!target) throw new Error("Unsupported conversion format.");
  const outName = `${baseName(file.name)}.${target.ext}`;

  if (targetId === "zip") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const zipped = zipSync({ [file.name || "file"]: bytes }, { level: 6 });
    return { blob: new Blob([zipped], { type: "application/zip" }), filename: outName };
  }

  if (targetId === "b64") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { blob: new Blob([btoa(bin)], { type: target.mime }), filename: outName };
  }

  if (isImage(file)) {
    const canvas = await renderImageToCanvas(blob);
    if (targetId === "pdf") {
      const jpegBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      return { blob: buildImagePdf(jpegBytes, canvas.width, canvas.height), filename: outName };
    }
    const outBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Image conversion failed."))), target.mime, 0.92);
    });
    return { blob: outBlob, filename: outName };
  }

  if (targetId === "wav" && isAudio(file)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Audio conversion is unsupported in this browser.");
    const ctx = new AudioCtx();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      return { blob: encodeWav(decoded), filename: outName };
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  const text = await blob.text();
  const srcExt = fileExt(file.name);

  if (srcExt === "json" && (targetId === "csv" || targetId === "tsv")) {
    const parsed = JSON.parse(text);
    const delim = targetId === "csv" ? "," : "\t";
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("JSON must be a non-empty array to convert to CSV/TSV.");
    let rows;
    if (Array.isArray(parsed[0])) {
      rows = parsed;
    } else if (typeof parsed[0] === "object" && parsed[0] !== null) {
      const keys = [...new Set(parsed.flatMap(item => (item && typeof item === "object" ? Object.keys(item) : [])))];
      rows = [keys, ...parsed.map(item => keys.map(k => (typeof item?.[k] === "object" ? JSON.stringify(item[k]) : item?.[k] ?? "")))];
    } else {
      rows = [["value"], ...parsed.map(v => [v])];
    }
    return { blob: new Blob([toDelimited(rows, delim)], { type: target.mime }), filename: outName };
  }

  if ((srcExt === "csv" || srcExt === "tsv") && (targetId === "json" || targetId === "csv" || targetId === "tsv" || targetId === "html")) {
    const rows = parseDelimited(text, srcExt === "tsv" ? "\t" : ",");
    if (targetId === "csv" || targetId === "tsv") {
      return { blob: new Blob([toDelimited(rows, targetId === "csv" ? "," : "\t")], { type: target.mime }), filename: outName };
    }
    if (targetId === "json") {
      const [header = [], ...body] = rows;
      const objects = body.map(r => Object.fromEntries(header.map((h, i) => [h || `col_${i + 1}`, r[i] ?? ""])));
      return { blob: new Blob([JSON.stringify(objects, null, 2)], { type: target.mime }), filename: outName };
    }
    if (targetId === "html") {
      const [header = [], ...body] = rows;
      const th = header.map(h => `<th>${escapeHtml(h)}</th>`).join("");
      const trs = body.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("\n");
      const html = `<!doctype html><html><meta charset="utf-8"><body><table border="1"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
      return { blob: new Blob([html], { type: target.mime }), filename: outName };
    }
  }

  if (targetId === "txt") {
    const out = srcExt === "html" || srcExt === "htm"
      ? (new DOMParser().parseFromString(text, "text/html").body.textContent ?? "")
      : text;
    return { blob: new Blob([out], { type: target.mime }), filename: outName };
  }
  if (targetId === "html") {
    const html = `<!doctype html><html><meta charset="utf-8"><title>${escapeHtml(file.name)}</title><body><pre>${escapeHtml(text)}</pre></body></html>`;
    return { blob: new Blob([html], { type: target.mime }), filename: outName };
  }
  if (targetId === "json") {
    return { blob: new Blob([JSON.stringify({ filename: file.name, content: text }, null, 2)], { type: target.mime }), filename: outName };
  }
  if (targetId === "pdf") {
    return { blob: buildTextPdf(text), filename: outName };
  }

  throw new Error("Unsupported conversion format.");
}
