const icons = {
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3m0 7h8m-8 4h6"/>',
  key: '<circle cx="16" cy="8" r="5"/><path d="m12.5 11.5-9 9H2v-4l3-3h3l3-3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m16 16 4 4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
  hash: '<path d="m10 4-4 16M18 4l-4 16M4 9h16M3 15h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2"/>',
  moon: '<path d="M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6m-6 4h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function icon(element, name) {
  element.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</svg>';
  return element;
}

document.querySelectorAll("[data-icon]").forEach(element => icon(element, element.dataset.icon));

const byId = id => document.getElementById(id);
const editor = byId("clip-text");
const count = byId("count");
const input = byId("file-input");
const drop = byId("drop");
const picked = byId("attachments");
const codeInput = byId("code");
const created = byId("created");
const retrieved = byId("retrieved");
const createMessage = byId("create-message");
const retrieveMessage = byId("retrieve-message");
const theme = byId("theme");
const toast = byId("toast");
const numberFormat = new Intl.NumberFormat();
const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const MAX_SIZE = 10_000_000;
const MAX_FILES = 8;
let files = [];
let toastTimeout;
let retrieval;

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function showMessage(element, value = "") {
  element.textContent = value;
  element.hidden = !value;
}

function notify(message) {
  clearTimeout(toastTimeout);
  showMessage(toast, message);
  toastTimeout = setTimeout(() => showMessage(toast), 2700);
}

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  icon(theme, value === "dark" ? "sun" : "moon");
  theme.setAttribute("aria-label", value === "dark" ? "Switch to light theme" : "Switch to dark theme");
}

applyTheme(readLocal("clipdrop.theme", "dark"));
theme.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  saveLocal("clipdrop.theme", next);
});

function refreshCount() {
  count.textContent = numberFormat.format(editor.value.length) + " / 50,000";
}

editor.addEventListener("input", refreshCount);
byId("paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    const free = 50000 - editor.value.length + editor.selectionEnd - editor.selectionStart;
    editor.setRangeText(text.slice(0, free), editor.selectionStart, editor.selectionEnd, "end");
    editor.focus();
    refreshCount();
    if (text.length > free) showMessage(createMessage, "Text can contain up to 50,000 characters.");
  } catch {
    editor.focus();
    showMessage(createMessage, "Use your device’s paste shortcut to add clipboard content.");
  }
});

function sizeLabel(bytes) {
  if (bytes < 1000) return bytes + " B";
  if (bytes < 1_000_000) return sizeFormat.format(bytes / 1000) + " KB";
  return sizeFormat.format(bytes / 1_000_000) + " MB";
}

function renderFiles() {
  picked.replaceChildren();
  files.forEach((file, index) => {
    const row = node("li", undefined, "file");
    const remove = node("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + file.name);
    icon(remove, "close");
    remove.addEventListener("click", () => {
      files.splice(index, 1);
      showMessage(createMessage);
      renderFiles();
      (picked.querySelectorAll("button")[Math.min(index, files.length - 1)] ?? byId("browse")).focus();
    });
    row.append(icon(node("span"), "file"), node("span", file.name, "file-name"), node("small", sizeLabel(file.size)), remove);
    picked.append(row);
  });
  picked.hidden = !files.length;
}

function addFiles(incoming) {
  if (drop.dataset.busy) return;
  const next = [...files, ...incoming];
  if (next.length > MAX_FILES) return showMessage(createMessage, "Add up to eight files per clip.");
  if (next.reduce((sum, file) => sum + file.size, 0) > MAX_SIZE) {
    return showMessage(createMessage, "Attachments can total up to 10 MB.");
  }
  files = next;
  renderFiles();
  showMessage(createMessage);
}

byId("browse").addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  addFiles(input.files);
  input.value = "";
});
drop.addEventListener("dragover", event => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", event => {
  if (!drop.contains(event.relatedTarget)) drop.classList.remove("dragging");
});
drop.addEventListener("drop", event => {
  event.preventDefault();
  drop.classList.remove("dragging");
  if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
});
editor.addEventListener("paste", event => {
  if (!event.clipboardData.files.length) return;
  addFiles(event.clipboardData.files);
  if (!event.clipboardData.getData("text/plain")) event.preventDefault();
});

function formatCode(value) {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return clean.length <= 4 ? clean : clean.slice(0, 4) + "-" + clean.slice(4);
}

codeInput.addEventListener("input", () => {
  const raw = codeInput.value;
  const position = codeInput.selectionStart;
  codeInput.value = formatCode(raw);
  if (position < raw.length) {
    const nextPosition = formatCode(raw.slice(0, position)).length;
    codeInput.setSelectionRange(nextPosition, nextPosition);
  }
});
codeInput.addEventListener("paste", event => {
  const value = event.clipboardData.getData("text");
  const shared = value.match(/#clip=([A-Z0-9-]+)/i)?.[1];
  if (!shared) return;
  event.preventDefault();
  codeInput.value = formatCode(shared);
});

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const type = response.headers.get("Content-Type");
  const data = type?.includes("application/json") ? await response.json() : null;
  if (!response.ok || !data) throw new Error(data?.error || "Could not reach Clipdrop. Try again in a moment.");
  return data;
}

async function copy(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    notify(label);
  } catch {
    notify("Clipboard access is unavailable.");
  }
}

function action(label, callback) {
  const button = node("button", label);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}

function tokenList() {
  return readLocal("clipdrop.tokens", []).filter(clip => clip.expiresAt > Date.now());
}

function shareURL(code) {
  const url = new URL("/", location.origin);
  url.hash = "clip=" + code;
  return url.href;
}

function resultHeader(target, code, expiresAt) {
  target.replaceChildren(node("strong", code), node("p", "Expires " + dateFormat.format(new Date(expiresAt))));
  target.hidden = false;
}

function deleteAction(clip, token, message) {
  return action("Delete clip", async event => {
    if (!confirm("Delete this clip for everyone who has its code?")) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/clips/" + clip.code, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
      saveLocal("clipdrop.tokens", tokenList().filter(item => item.code !== clip.code));
      for (const target of [created, retrieved]) {
        if (target.dataset.code === clip.code) {
          target.hidden = true;
          target.replaceChildren();
        }
      }
      notify("Clip deleted.");
    } catch (error) {
      showMessage(message, error.message);
      button.disabled = false;
    }
  });
}

byId("create-form").addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(createMessage);
  if (!editor.value.trim() && !files.length) {
    editor.focus();
    return showMessage(createMessage, "Add some text or attach a file to create a clip.");
  }
  const button = byId("create-button");
  const controls = [editor, byId("paste"), byId("browse"), byId("expiry"), ...picked.querySelectorAll("button")];
  const form = new FormData();
  form.append("text", new Blob([editor.value], { type: "text/plain" }), "clip.txt");
  form.append("expiry", byId("expiry").value);
  for (const file of files) form.append("file", file);
  button.disabled = true;
  button.lastChild.textContent = " Generating…";
  for (const control of controls) control.disabled = true;
  drop.dataset.busy = "true";
  try {
    const clip = await api("/api/clips", { method: "POST", body: form });
    saveLocal("clipdrop.tokens", [...tokenList().slice(-23), clip]);
    resultHeader(created, clip.code, clip.expiresAt);
    created.dataset.code = clip.code;
    const actions = node("div", undefined, "result-actions");
    actions.append(action("Copy code", () => copy(clip.code, "Code copied.")),
      action("Copy link", () => copy(shareURL(clip.code), "Link copied.")), deleteAction(clip, clip.deleteToken, createMessage));
    created.append(actions);
    notify("Clip ready to share.");
  } catch (error) {
    showMessage(createMessage, error.message);
  } finally {
    for (const control of controls) control.disabled = false;
    delete drop.dataset.busy;
    button.disabled = false;
    button.lastChild.textContent = " Generate code";
  }
});

function renderClip(clip) {
  resultHeader(retrieved, clip.code, clip.expiresAt);
  retrieved.dataset.code = clip.code;
  const actions = node("div", undefined, "result-actions");
  if (clip.text) {
    const contents = node("pre", clip.text);
    contents.tabIndex = 0;
    retrieved.append(contents);
    actions.append(action("Copy text", () => copy(clip.text, "Text copied.")));
  }
  if (clip.attachments.length) {
    const list = node("ul", undefined, "files");
    list.setAttribute("aria-label", "Clip attachments");
    clip.attachments.forEach((file, index) => {
      const path = "/api/clips/" + clip.code + "/files/" + index;
      const row = node("li", undefined, "file");
      if (file.type.startsWith("image/")) {
        const image = node("img");
        image.src = path + "?preview";
        image.alt = "";
        image.loading = "lazy";
        row.append(image);
      } else {
        row.append(icon(node("span"), "file"));
      }
      const link = node("a", "Download");
      link.href = path;
      link.download = file.name;
      link.setAttribute("aria-label", "Download " + file.name);
      row.append(node("span", file.name, "file-name"), node("small", sizeLabel(file.size)), link);
      list.append(row);
    });
    retrieved.append(list);
  }
  actions.append(action("Copy link", () => copy(shareURL(clip.code), "Link copied.")));
  const ownClip = tokenList().find(item => item.code === clip.code);
  if (ownClip) actions.append(deleteAction(clip, ownClip.deleteToken, retrieveMessage));
  retrieved.append(actions);
}

byId("retrieve-form").addEventListener("submit", async event => {
  event.preventDefault();
  retrieval?.abort();
  const request = new AbortController();
  retrieval = request;
  const code = formatCode(codeInput.value);
  const button = byId("retrieve-button");
  retrieved.hidden = true;
  retrieved.replaceChildren();
  showMessage(retrieveMessage);
  if (!/^[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/.test(code)) {
    button.disabled = false;
    button.lastChild.textContent = " Retrieve clip";
    codeInput.focus();
    return showMessage(retrieveMessage, "Enter a valid eight-character share code.");
  }
  button.disabled = true;
  button.lastChild.textContent = " Retrieving…";
  try {
    const clip = await api("/api/clips/" + code, { signal: request.signal });
    if (request.signal.aborted) return;
    renderClip(clip);
    notify("Clip opened.");
  } catch (error) {
    if (!request.signal.aborted) showMessage(retrieveMessage, error.message);
  } finally {
    if (retrieval === request) {
      button.disabled = false;
      button.lastChild.textContent = " Retrieve clip";
    }
  }
});

function openShareLink() {
  const code = new URLSearchParams(location.hash.slice(1)).get("clip");
  if (!code) return;
  codeInput.value = formatCode(code);
  byId("retrieve").scrollIntoView();
  byId("retrieve-form").requestSubmit();
}

window.addEventListener("hashchange", openShareLink);
openShareLink();
