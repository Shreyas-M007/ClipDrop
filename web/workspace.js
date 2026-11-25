import { Y } from "/tools.js";
import { createScreens } from "/screens.js";

export function createScratchpad({ textarea, status, request, cleared }) {
  let state;

  function syncText(doc) {
    const value = doc.getText("pad").toString();
    if (textarea.value === value) return;
    const { selectionStart, selectionEnd } = textarea;
    textarea.value = value;
    if (document.activeElement === textarea) textarea.setSelectionRange(selectionStart, selectionEnd);
  }

  function apply(doc, update) {
    if (update) Y.applyUpdate(doc, Uint8Array.from(atob(update), char => char.charCodeAt(0)), "remote");
  }

  async function poll(target) {
    if (!target || state !== target || target.polling || document.hidden) return;
    target.polling = true;
    try {
      const headers = target.revision ? { "X-Pad-Revision": target.revision } : {};
      const response = await request(target.room, "pad", { headers, signal: target.controller.signal });
      if (state !== target) return;
      const value = await response.json();
      if (state !== target) return;
      target.revision = value.revision;
      if (!value.unchanged) apply(target.doc, value.state);
      textarea.disabled = false;
      if (!target.updates.length) status("");
    } catch (error) {
      if (state === target && error.status === 410) cleared();
      else if (state === target) status(error.message);
    } finally {
      target.polling = false;
    }
  }

  async function flush(target) {
    if (state !== target || target.saving || !target.updates.length) return;
    target.saving = true;
    const batch = target.updates[0];
    try {
      const response = await request(target.room, "pad", {
        method: "POST", body: batch, signal: target.controller.signal,
      });
      const value = await response.json();
      if (state !== target) return;
      target.updates.shift();
      apply(target.doc, value.state);
      status("");
    } catch (error) {
      if (state !== target) return;
      if (error.status === 410) return cleared();
      if ([400, 413].includes(error.status)) {
        stop();
        start(target.room);
        status(error.message);
        return;
      }
      status("Could not sync the scratchpad. Retrying…");
      target.retryAt = Date.now() + 2500;
    } finally {
      target.saving = false;
    }
    if (state === target && Date.now() >= target.retryAt) void flush(target);
  }

  function stop() {
    if (state) {
      state.controller.abort();
      state.doc.destroy();
      state = null;
    }
    textarea.value = "";
    textarea.disabled = true;
    status("");
  }

  function start(room) {
    stop();
    const doc = new Y.Doc();
    const text = doc.getText("pad");
    const target = state = { room, doc, controller: new AbortController(), updates: [], retryAt: 0 };
    text.observe(() => syncText(doc));
    doc.on("update", (update, origin) => {
      if (origin !== "local") return;
      target.updates.push(update);
      if (Date.now() >= target.retryAt) void flush(target);
    });
    void poll(target);
  }

  textarea.addEventListener("input", () => {
    if (!state) return;
    const { doc } = state;
    const text = doc.getText("pad");
    const before = Array.from(text.toString());
    const after = Array.from(textarea.value);
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start &&
      before[before.length - end - 1] === after[after.length - end - 1]) end++;
    const offset = before.slice(0, start).join("").length;
    const deleted = before.slice(start, before.length - end).join("").length;
    const added = after.slice(start, after.length - end).join("");
    doc.transact(() => {
      if (deleted) text.delete(offset, deleted);
      if (added) text.insert(offset, added);
    }, "local");
  });

  return { start, stop, tick() {
    if (state) {
      if (Date.now() >= state.retryAt) void flush(state);
      void poll(state);
    }
  } };
}

export function createHostedScreens({ controls, request, warning, cleared, draw }) {
  let target;
  const video = createScreens({
    identity: () => target?.id,
    changed(state) {
      if (target) target.state = state;
      draw(state);
    },
    warning,
    async rpc(event, data) {
      const current = target;
      if (!current) return;
      if (event === "screen:state") {
        current.active = data.active;
        try { await heartbeat(current, true); }
        catch (error) { current.active = false; throw error; }
      } else {
        await request(current.room, "signal", {
          method: "POST", body: JSON.stringify(data), signal: current.controller.signal,
        });
      }
    },
  });

  async function heartbeat(current, force = false) {
    if (target !== current || (!force && (!controls.open || document.hidden || current.waiting))) return;
    if (current.waiting) {
      try { await current.waiting; } catch {}
      if (target !== current) return;
    }
    const pending = request(current.room, "presence", {
      method: "POST", body: JSON.stringify({ active: current.active }), signal: current.controller.signal,
    }).then(response => response.json()).then(state => {
      if (target !== current) return;
      current.id = state.id;
      video.sync(state);
      for (const message of state.messages) {
        if (current.seen.has(message.key)) continue;
        current.seen.add(message.key);
        video.signal(message);
      }
      if (current.seen.size > 250) current.seen = new Set([...current.seen].slice(-100));
      controls.querySelector("#start-room-screen").disabled = false;
    });
    current.waiting = pending;
    try { await pending; }
    finally { if (current.waiting === pending) current.waiting = null; }
  }

  function tick() {
    if (!target) return;
    const current = target;
    heartbeat(current, current.active && !current.waiting).catch(error => {
      if (target === current && error.status === 410) cleared();
    });
  }

  function stop() {
    if (target) {
      const current = target;
      target = null;
      current.controller.abort();
      request(current.room, "presence", { method: "POST", body: JSON.stringify({ active: false, leave: true }),
        keepalive: true }).catch(() => {});
    }
    video.reset();
    controls.querySelector("#start-room-screen").disabled = true;
  }

  return {
    enter(room) {
      stop();
      target = { room, controller: new AbortController(), active: false, seen: new Set() };
      tick();
    },
    tick, stop,
    startScreen: video.start,
    stopScreen: video.stop,
  };
}
