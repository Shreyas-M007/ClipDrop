(() => {
  if (window.__clipdropKeydropLoaded) return;
  window.__clipdropKeydropLoaded = true;

  let state = { active: false, paused: false, cancelled: false, resumeWait: null };

  function resolveActiveElement(doc = document) {
    let el = doc.activeElement;
    while (el && el.tagName === "IFRAME") {
      try {
        if (!el.contentDocument) break;
        el = el.contentDocument.activeElement;
      } catch {
        break;
      }
    }
    return el;
  }

  function isEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const blocked = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
      return !blocked.has((el.type || "text").toLowerCase());
    }
    return false;
  }

  function setNativeValue(el, nextValue) {
    const win = el.ownerDocument.defaultView || window;
    const proto = el.tagName === "TEXTAREA" ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) descriptor.set.call(el, nextValue);
    else el.value = nextValue;
  }

  function insertChunk(el, chunk) {
    const doc = el.ownerDocument;
    if (el.isContentEditable) {
      const sel = doc.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = chunk === "\n" ? doc.createElement("br") : doc.createTextNode(chunk);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.textContent = (el.textContent || "") + chunk;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: chunk }));
      return;
    }

    const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : el.value.length;
    setNativeValue(el, el.value.slice(0, start) + chunk + el.value.slice(end));
    if (typeof el.setSelectionRange === "function") {
      const caret = start + chunk.length;
      el.setSelectionRange(caret, caret);
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: chunk }));
  }

  function dispatchKey(el, char) {
    const key = char === "\n" ? "Enter" : char;
    const init = { key, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: char }));
    insertChunk(el, char);
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function stopTyping() {
    state.cancelled = true;
    state.active = false;
    state.paused = false;
    if (state.resumeWait) {
      state.resumeWait();
      state.resumeWait = null;
    }
  }

  async function runTyping({ text, mode, speedMs }) {
    stopTyping();
    const el = resolveActiveElement();
    if (!isEditable(el)) {
      return { ok: false, error: "Click inside an input, textarea, or editable field first." };
    }
    state = { active: true, paused: false, cancelled: false, resumeWait: null };
    el.focus();

    if (mode === "instant") {
      insertChunk(el, text);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      state.active = false;
      return { ok: true };
    }

    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      if (state.cancelled) return { ok: true, stopped: true };
      if (state.paused) {
        await new Promise(resolve => { state.resumeWait = resolve; });
        if (state.cancelled) return { ok: true, stopped: true };
      }
      dispatchKey(el, chars[i]);
      if (speedMs > 0 && i < chars.length - 1) {
        await new Promise(resolve => setTimeout(resolve, speedMs));
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    state.active = false;
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "KEYDROP_START") {
      runTyping(msg).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (msg.type === "KEYDROP_PAUSE") {
      if (state.active) state.paused = true;
      sendResponse({ ok: true });
    } else if (msg.type === "KEYDROP_RESUME") {
      if (state.active && state.paused) {
        state.paused = false;
        if (state.resumeWait) {
          state.resumeWait();
          state.resumeWait = null;
        }
      }
      sendResponse({ ok: true });
    } else if (msg.type === "KEYDROP_STOP") {
      stopTyping();
      sendResponse({ ok: true });
    }
  });
})();
