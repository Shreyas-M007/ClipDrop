import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';

const languages = { javascript, typescript, python, html: xml, css, bash, sql };
const extensions = { javascript: 'js', typescript: 'ts', python: 'py', html: 'html', css: 'css', bash: 'sh', sql: 'sql' };
for (const [name, syntax] of Object.entries(languages)) hljs.registerLanguage(name, syntax);

function base64(value) {
  const data = value.match(/^data:[-\w.+/]+;base64,(.*)$/s)?.[1] ?? value;
  const compact = data.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (compact.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 === 1) return null;
  try {
    const decoded = atob(compact);
    if (btoa(decoded).replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null;
    if (data === value && /^\w+$/.test(compact) && compact.length < 16) {
      const candidate = new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(decoded, char => char.charCodeAt(0)));
      if (/[\x00-\x08\x0e-\x1f]/.test(candidate)) return null;
    }
    return Uint8Array.from(decoded, char => char.charCodeAt(0));
  } catch { return null; }
}

export function detectPayload(text) {
  const value = text.trim();
  if (/^[{[]/.test(value)) {
    try {
      return { format: 'json', extension: 'json', formatted: JSON.stringify(JSON.parse(value), null, 2) };
    } catch {}
  }
  const fenced = value.match(/^```\s*([^\n]*)\n([\s\S]*?)\n```$/);
  const aliases = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', xml: 'html' };
  const tag = fenced?.[1].trim().toLowerCase();
  const code = fenced?.[2] ?? value;
  const language = Object.hasOwn(languages, aliases[tag] ?? tag) ? aliases[tag] ?? tag : null;
  if (language) return { format: 'code', language, extension: extensions[language], code };
  if (/^[\w+/=\s-]+$/.test(value) || value.startsWith('data:')) {
    const decoded = base64(value);
    if (decoded) {
      let decodedText;
      try { decodedText = new TextDecoder('utf-8', {fatal:true}).decode(decoded); } catch {}
      if (decodedText && /[\x00-\x08\x0e-\x1f]/.test(decodedText)) decodedText = undefined;
      return { format: 'base64', decoded, decodedText, extension: 'bin' };
    }
  }
  if (fenced || /[{};<>\n]|^(?:def |SELECT |import |const |function )/.test(code)) {
    const result = hljs.highlightAuto(code.slice(0, 16000), Object.keys(languages));
    if (result.language && result.relevance >= 2) {
      return { format: 'code', language: result.language, extension: extensions[result.language], code };
    }
    if (fenced) return { format: 'code', extension: 'txt', code };
  }
  return { format: 'text', extension: 'txt' };
}
