import qrcode from "/qrcode.js";

const icons = {
  clipboard: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3m0 7h8m-8 4h6"/>',
  key: '<circle cx="16" cy="8" r="5"/><path d="m12.5 11.5-9 9H2v-4l3-3h3l3-3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m16 16 4 4"/>',
  qr: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3m-6 3h1m5-7v1"/>',
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
const retrieveForm = byId("retrieve-form");
const customCodeInput = byId("custom-code");
const changeDialog = byId("change-dialog");
const replacementCode = byId("replacement-code");
const changeButton = byId("change-button");
const closeChange = changeDialog.querySelector(".dialog-close");
const shareDialog = byId("share-dialog");
const recentList = byId("recent-list");
const clearRecent = byId("clear-recent");
const CLIP_ALPHABET = "[23456789A-HJ-NP-Z]";
const CODE_PART = CLIP_ALPHABET + "{4}";
const FULL_CODE = /^[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/i;
const CODE_HELP = "Use 4–24 letters, numbers, or hyphens. Start and end with a letter or number.";
const SPACED_GENERATED = new RegExp("^(" + CODE_PART + ")\\s+(" + CODE_PART + ")$");
const MESSAGE_CODE = new RegExp("\\b(" + CODE_PART + ")\\s*[-–—]\\s*(" + CODE_PART + ")\\b", "i");
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
let clipToChange;
let visibleClip;

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
  showMessage(toast);
  showMessage(byId("share-status"));
  const status = shareDialog.open ? byId("share-status") : toast;
  showMessage(status, message);
  toastTimeout = setTimeout(() => showMessage(status), 2700);
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

applyTheme(readLocal("clipdrop.theme", "light"));
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

function extractCode(value) {
  for (const item of value.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    let url;
    try { url = new URL(item.replace(/[),.!?;]+$/, "")); } catch { continue; }
    if (url.origin !== location.origin || url.pathname !== "/") continue;
    const code = new URLSearchParams(url.hash.slice(1)).get("clip")?.toUpperCase();
    if (code && FULL_CODE.test(code)) return code;
  }
  const plain = value.trim().toUpperCase().replace(/[–—]/g, "-");
  if (FULL_CODE.test(plain)) return plain;
  const legacy = plain.match(SPACED_GENERATED);
  if (legacy) return legacy[1] + "-" + legacy[2];
  const message = value.replace(/https?:\/\/[^\s<>"']+/gi, " ");
  const labelled = message.match(/\bcode:\s*([A-Z0-9-]+)\b/i)?.[1]?.toUpperCase();
  if (labelled && FULL_CODE.test(labelled)) return labelled;
  const match = message.match(MESSAGE_CODE);
  return match ? (match[1] + "-" + match[2]).toUpperCase() : null;
}

codeInput.addEventListener("input", () => showMessage(retrieveMessage));
codeInput.addEventListener("paste", event => {
  const code = extractCode(event.clipboardData.getData("text/plain"));
  if (!code) return;
  event.preventDefault();
  codeInput.value = code;
  showMessage(retrieveMessage);
});

function focusCode() {
  byId("retrieve").scrollIntoView({ block: "nearest" });
  codeInput.focus({ preventScroll: true });
}

byId("open-nav").addEventListener("click", event => {
  event.preventDefault();
  focusCode();
});
window.addEventListener("keydown", event => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || shareDialog.open ||
      event.target.closest?.("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  focusCode();
});

byId("paste-code").addEventListener("click", async () => {
  try {
    const code = extractCode(await navigator.clipboard.readText());
    if (code) return openCode(code);
    showMessage(retrieveMessage, "Copy a Clipdrop code or share message first.");
  } catch {
    showMessage(retrieveMessage, "Paste into the code field using your device’s paste shortcut.");
  }
  focusCode();
});

async function api(path, options) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const type = response.headers.get("Content-Type");
  const data = type?.includes("application/json") ? await response.json() : null;
  if (!response.ok || !data) {
    const error = new Error(data?.error || "Could not reach Clipdrop. Try again in a moment.");
    error.status = response.status;
    throw error;
  }
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

function recentClips() {
  return readLocal("clipdrop.recent", []).filter(entry => FULL_CODE.test(entry.code) && entry.expiresAt > Date.now());
}

function renderRecent() {
  const clips = recentClips();
  recentList.replaceChildren();
  for (const clip of clips) {
    const row = node("li");
    const button = action(clip.code, () => openCode(clip.code));
    button.append(node("span", clip.created ? "Created" : "Opened"), icon(node("span"), "chevron"));
    row.append(button);
    recentList.append(row);
  }
  recentList.hidden = !clips.length;
  clearRecent.hidden = !clips.length;
  byId("recent-empty").hidden = Boolean(clips.length);
}

function rememberClip(clip, createdHere) {
  const recent = recentClips();
  const wasCreated = recent.find(item => item.code === clip.code)?.created;
  saveLocal("clipdrop.recent", [
    { code: clip.code, expiresAt: clip.expiresAt, created: Boolean(createdHere || wasCreated) },
    ...recent.filter(item => item.code !== clip.code),
  ].slice(0, 5));
  renderRecent();
}

function forgetClip(code) {
  saveLocal("clipdrop.recent", recentClips().filter(item => item.code !== code));
  renderRecent();
}

clearRecent.addEventListener("click", () => {
  saveLocal("clipdrop.recent", []);
  renderRecent();
  focusCode();
});
window.addEventListener("storage", event => {
  if (event.key === "clipdrop.recent") renderRecent();
});
renderRecent();

function shareAction(clip) {
  return action("Share clip", () => {
    const url = shareURL(clip.code);
    const message = "Open my Clipdrop clip: " + url + "\nCode: " + clip.code +
      "\nExpires " + dateFormat.format(new Date(clip.expiresAt));
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const canvas = byId("share-qr");
    const size = qr.getModuleCount();
    const scale = 5;
    const margin = 4;
    canvas.width = canvas.height = (size + margin * 2) * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#161411";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }

    byId("share-code").textContent = clip.code;
    const actions = byId("share-actions");
    actions.replaceChildren(
      action("Copy teammate message", () => copy(message, "Teammate message copied.")),
      action("Copy link", () => copy(url, "Link copied.")),
      action("Copy code", () => copy(clip.code, "Code copied.")),
    );
    if (typeof navigator.share === "function") {
      actions.append(action("Share from device", async () => {
        try {
          await navigator.share({ title: "Clipdrop", text: "Open my clip with code " + clip.code, url });
        } catch (error) {
          if (error.name !== "AbortError") notify("Use Copy teammate message to share this clip.");
        }
      }));
    }
    showMessage(byId("share-status"));
    shareDialog.showModal();
  });
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
      forgetClip(clip.code);
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

function renderCreated(clip, token) {
  resultHeader(created, clip.code, clip.expiresAt);
  created.dataset.code = clip.code;
  const actions = node("div", undefined, "result-actions");
  const share = shareAction(clip);
  share.classList.add("action-accent");
  actions.append(share,
    action("Copy code", () => copy(clip.code, "Code copied.")),
    action("Copy link", () => copy(shareURL(clip.code), "Link copied.")),
    changeAction(clip, token),
    deleteAction(clip, token, createMessage),
  );
  created.append(actions);
}

function changeAction(clip, token) {
  return action("Change code", () => {
    clipToChange = { clip, token };
    replacementCode.value = "";
    showMessage(byId("change-message"));
    changeDialog.showModal();
  });
}

changeDialog.addEventListener("cancel", event => {
  if (changeButton.disabled) event.preventDefault();
});

byId("change-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (changeButton.disabled) return;
  const message = byId("change-message");
  const code = replacementCode.value.trim();
  if (code && !FULL_CODE.test(code)) {
    replacementCode.focus();
    return showMessage(message, CODE_HELP);
  }
  const { clip, token } = clipToChange;
  const body = new FormData();
  body.set("code", code);
  showMessage(message);
  changeButton.disabled = true;
  changeButton.textContent = "Changing…";
  closeChange.disabled = true;
  replacementCode.disabled = true;
  try {
    const changed = await api("/api/clips/" + clip.code, {
      method: "POST", body, headers: { Authorization: "Bearer " + token },
    });
    const updated = { ...changed, deleteToken: token };
    saveLocal("clipdrop.tokens", [...tokenList().filter(item => item.code !== clip.code).slice(-23), updated]);
    forgetClip(clip.code);
    rememberClip(updated, true);
    if (!created.hidden && created.dataset.code === clip.code) renderCreated(updated, token);
    if (!retrieved.hidden && retrieved.dataset.code === clip.code) {
      renderClip({ ...visibleClip, ...changed });
      codeInput.value = changed.code;
    }
    if (new URLSearchParams(location.hash.slice(1)).get("clip")?.toUpperCase() === clip.code) {
      history.replaceState(null, "", shareURL(changed.code));
    }
    changeDialog.close();
    (created.dataset.code === changed.code && !created.hidden ? created : retrieved)
      .querySelector("button")?.focus({ preventScroll: true });
    notify("Code changed. Share the new code with your teammates.");
  } catch (error) {
    showMessage(message, error.message);
  } finally {
    changeButton.disabled = false;
    changeButton.textContent = "Change code";
    closeChange.disabled = false;
    replacementCode.disabled = false;
  }
});

byId("create-form").addEventListener("submit", async event => {
  event.preventDefault();
  showMessage(createMessage);
  if (!editor.value.trim() && !files.length) {
    editor.focus();
    return showMessage(createMessage, "Add some text or attach a file to create a clip.");
  }
  const customCode = customCodeInput.value.trim();
  if (customCode && !FULL_CODE.test(customCode)) {
    customCodeInput.focus();
    return showMessage(createMessage, CODE_HELP);
  }
  const button = byId("create-button");
  const controls = [editor, customCodeInput, byId("paste"), byId("browse"), byId("expiry"), ...picked.querySelectorAll("button")];
  const form = new FormData();
  form.append("text", new Blob([editor.value], { type: "text/plain" }), "clip.txt");
  form.append("expiry", byId("expiry").value);
  if (customCode) form.append("code", customCode);
  for (const file of files) form.append("file", file);
  button.disabled = true;
  button.lastChild.textContent = " Creating…";
  for (const control of controls) control.disabled = true;
  drop.dataset.busy = "true";
  try {
    const clip = await api("/api/clips", { method: "POST", body: form });
    saveLocal("clipdrop.tokens", [...tokenList().slice(-23), clip]);
    renderCreated(clip, clip.deleteToken);
    rememberClip(clip, true);
    created.scrollIntoView({ block: "nearest" });
    notify("Clip ready to share.");
  } catch (error) {
    showMessage(createMessage, error.message);
  } finally {
    for (const control of controls) control.disabled = false;
    delete drop.dataset.busy;
    button.disabled = false;
    button.lastChild.textContent = " Create clip";
  }
});

function renderClip(clip) {
  visibleClip = clip;
  codeInput.value = clip.code;
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
  actions.append(shareAction(clip), action("Copy link", () => copy(shareURL(clip.code), "Link copied.")));
  const ownClip = tokenList().find(item => item.code === clip.code);
  if (ownClip) actions.append(changeAction(clip, ownClip.deleteToken), deleteAction(clip, ownClip.deleteToken, retrieveMessage));
  retrieved.append(actions);
}

retrieveForm.addEventListener("submit", async event => {
  event.preventDefault();
  retrieval?.abort();
  const request = new AbortController();
  retrieval = request;
  const code = extractCode(codeInput.value);
  const button = byId("retrieve-button");
  retrieved.hidden = true;
  retrieved.replaceChildren();
  showMessage(retrieveMessage);
  if (!code) {
    button.disabled = false;
    button.lastChild.textContent = " Open clip";
    codeInput.focus();
    return showMessage(retrieveMessage, "Enter a share code or paste a Clipdrop link or teammate message.");
  }
  codeInput.value = code;
  button.disabled = true;
  button.lastChild.textContent = " Opening…";
  try {
    const clip = await api("/api/clips/" + code, { signal: request.signal });
    if (request.signal.aborted) return;
    renderClip(clip);
    rememberClip(clip, tokenList().some(item => item.code === clip.code));
    retrieved.scrollIntoView({ block: "nearest" });
    notify("Clip opened.");
  } catch (error) {
    if (!request.signal.aborted) {
      if (error.status === 404) forgetClip(code);
      showMessage(retrieveMessage, error.message);
    }
  } finally {
    if (retrieval === request) {
      button.disabled = false;
      button.lastChild.textContent = " Open clip";
    }
  }
});

function openCode(value) {
  codeInput.value = value;
  byId("retrieve").scrollIntoView({ block: "nearest" });
  retrieveForm.requestSubmit();
}

function openShareLink() {
  const code = new URLSearchParams(location.hash.slice(1)).get("clip");
  if (code) openCode(code);
}

window.addEventListener("hashchange", openShareLink);
openShareLink();
