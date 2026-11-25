const $ = id => document.getElementById(id);
const serverInput = $("server-url");
const roomInput = $("room-code");
const modeSelect = $("mode");
const speedInput = $("speed");
const refreshBtn = $("refresh-btn");
const typeBtn = $("type-btn");
const pauseBtn = $("pause-btn");
const stopBtn = $("stop-btn");
const previewBox = $("preview-box");
const previewMeta = $("preview-meta");
const previewText = $("preview-text");
const statusEl = $("status");

let queuedItem = null;
let paused = false;

function setStatus(text = "", ok = false) {
  statusEl.textContent = text;
  statusEl.className = ok ? "status ok" : "status";
  statusEl.hidden = !text;
}

function normalizeOrigin(raw) {
  const url = new URL(raw.trim());
  return url.origin;
}

async function savePrefs() {
  await chrome.storage.local.set({
    serverUrl: serverInput.value.trim(),
    roomCode: roomInput.value.trim().toUpperCase(),
    mode: modeSelect.value,
    speedMs: Number(speedInput.value) || 35,
  });
}

async function loadPrefs() {
  const data = await chrome.storage.local.get(["serverUrl", "roomCode", "mode", "speedMs"]);
  if (data.serverUrl) serverInput.value = data.serverUrl;
  if (data.roomCode) roomInput.value = data.roomCode;
  if (data.mode) modeSelect.value = data.mode;
  if (typeof data.speedMs === "number") speedInput.value = String(data.speedMs);
}

async function fetchQueue() {
  setStatus("");
  queuedItem = null;
  typeBtn.disabled = true;
  previewBox.hidden = true;
  let origin;
  try { origin = normalizeOrigin(serverInput.value); } catch {
    return setStatus("Enter a valid ClipDrop server URL (e.g. https://...).");
  }
  const code = roomInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$/i.test(code)) {
    return setStatus("Enter a valid room code (4–24 letters/numbers/hyphens).");
  }
  await savePrefs();
  refreshBtn.disabled = true;
  try {
    const res = await fetch(`${origin}/api/rooms/${encodeURIComponent(code)}/type-queue`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not fetch KeyDrop queue.");
    const items = data.items || [];
    if (!items.length) {
      return setStatus("No queued text in this room. Send text from ClipDrop first.");
    }
    queuedItem = items[0];
    previewMeta.textContent = `${queuedItem.length} chars · ${queuedItem.mode} · expires in < 2m`;
    previewText.textContent = queuedItem.preview;
    previewBox.hidden = false;
    typeBtn.disabled = false;
    setStatus(`Ready (${items.length} queued). Focus target field & click Type.`, true);
  } catch (err) {
    setStatus(err.message || "Could not reach ClipDrop.");
  } finally {
    refreshBtn.disabled = false;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active browser tab found.");
  return tab;
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}

function setTypingUI(active) {
  typeBtn.hidden = active;
  pauseBtn.hidden = !active;
  stopBtn.hidden = !active;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
}

typeBtn.addEventListener("click", async () => {
  if (!queuedItem) return;
  setStatus("");
  let origin;
  try { origin = normalizeOrigin(serverInput.value); } catch { return setStatus("Invalid server URL."); }
  const code = roomInput.value.trim().toUpperCase();
  typeBtn.disabled = true;
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab.id);
    const claimRes = await fetch(
      `${origin}/api/rooms/${encodeURIComponent(code)}/type-queue/${queuedItem.id}/claim`,
      { method: "POST" }
    );
    const payload = await claimRes.json();
    if (!claimRes.ok) throw new Error(payload.error || "Could not claim queued text.");

    const mode = modeSelect.value;
    const speedMs = Math.min(500, Math.max(0, Number(speedInput.value) || 0));
    paused = false;
    setTypingUI(true);
    const reply = await chrome.tabs.sendMessage(tab.id, {
      type: "KEYDROP_START",
      text: payload.text,
      mode,
      speedMs,
    });
    if (!reply?.ok) throw new Error(reply?.error || "Could not type into this page.");
    setStatus("Finished typing into focused field.", true);
    queuedItem = null;
    previewBox.hidden = true;
  } catch (err) {
    setStatus(err.message || "Automated typing unavailable on this page. Copy from ClipDrop instead.");
  } finally {
    setTypingUI(false);
    typeBtn.disabled = !queuedItem;
  }
});

pauseBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    await chrome.tabs.sendMessage(tab.id, { type: paused ? "KEYDROP_PAUSE" : "KEYDROP_RESUME" });
  } catch {}
});

stopBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    await chrome.tabs.sendMessage(tab.id, { type: "KEYDROP_STOP" });
    setTypingUI(false);
    setStatus("Typing stopped.", true);
  } catch {}
});

refreshBtn.addEventListener("click", fetchQueue);
[serverInput, roomInput, modeSelect, speedInput].forEach(el => el.addEventListener("change", savePrefs));

loadPrefs().then(() => {
  if (serverInput.value && roomInput.value) fetchQueue();
});
