/**
 * KeyDrop typing engine & bookmarklet generator.
 * Supports input, textarea, and contenteditable targets, including
 * React/Vue controlled inputs, multiline text, special characters, and emojis.
 */

export function isEditableTarget(element) {
  if (!element || element.disabled || element.readOnly) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName === "INPUT") {
    const blocked = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
    return !blocked.has((element.type || "text").toLowerCase());
  }
  return false;
}

function setNativeValue(element, nextValue) {
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(element, nextValue);
  else element.value = nextValue;
}

function insertChunk(element, chunk) {
  if (element.isContentEditable) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const node = chunk === "\n" ? document.createElement("br") : document.createTextNode(chunk);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      element.textContent = (element.textContent || "") + chunk;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: chunk }));
    return;
  }

  const start = typeof element.selectionStart === "number" ? element.selectionStart : element.value.length;
  const end = typeof element.selectionEnd === "number" ? element.selectionEnd : element.value.length;
  const before = element.value.slice(0, start);
  const after = element.value.slice(end);
  setNativeValue(element, before + chunk + after);
  if (typeof element.setSelectionRange === "function") {
    const caret = start + chunk.length;
    element.setSelectionRange(caret, caret);
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: chunk }));
}

function dispatchKey(element, char) {
  const key = char === "\n" ? "Enter" : char;
  const init = { key, bubbles: true, cancelable: true };
  element.dispatchEvent(new KeyboardEvent("keydown", init));
  element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: char }));
  insertChunk(element, char);
  element.dispatchEvent(new KeyboardEvent("keyup", init));
}

export function createTyper() {
  let state = { active: false, paused: false, cancelled: false, resumeWait: null };

  function stop() {
    state.cancelled = true;
    state.active = false;
    state.paused = false;
    if (state.resumeWait) {
      state.resumeWait();
      state.resumeWait = null;
    }
  }

  function pause() {
    if (state.active) state.paused = true;
  }

  function resume() {
    if (!state.active || !state.paused) return;
    state.paused = false;
    if (state.resumeWait) {
      state.resumeWait();
      state.resumeWait = null;
    }
  }

  async function type(element, text, { mode = "keystroke", speedMs = 35, onProgress } = {}) {
    stop();
    if (!isEditableTarget(element)) {
      throw new Error("Focus an editable input, textarea, or rich-text field first.");
    }
    state = { active: true, paused: false, cancelled: false, resumeWait: null };
    const chars = Array.from(text); // Preserves surrogate pairs / emojis
    element.focus();

    if (mode === "instant") {
      insertChunk(element, text);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      state.active = false;
      onProgress?.(chars.length, chars.length);
      return;
    }

    for (let i = 0; i < chars.length; i++) {
      if (state.cancelled) return;
      if (state.paused) {
        await new Promise(resolve => { state.resumeWait = resolve; });
        if (state.cancelled) return;
      }
      dispatchKey(element, chars[i]);
      onProgress?.(i + 1, chars.length);
      if (speedMs > 0 && i < chars.length - 1) {
        await new Promise(resolve => setTimeout(resolve, speedMs));
      }
    }
    element.dispatchEvent(new Event("change", { bubbles: true }));
    state.active = false;
  }

  return {
    type,
    pause,
    resume,
    stop,
    get status() {
      return state.active ? (state.paused ? "paused" : "typing") : "idle";
    },
  };
}

export function buildBookmarklet(origin, roomCode) {
  const code = `(async function(){
const el=document.activeElement;
const ok=el&&!el.disabled&&!el.readOnly&&(el.isContentEditable||el.tagName==="TEXTAREA"||(el.tagName==="INPUT"&&!/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type)));
if(!ok){alert("KeyDrop: Click inside a text field first, then run this bookmarklet.");return;}
const r=${JSON.stringify(roomCode)}||prompt("Enter ClipDrop room code:");
if(!r)return;
const base=${JSON.stringify(origin)}+"/api/rooms/"+encodeURIComponent(r.trim().toUpperCase())+"/type-queue";
try{
const list=await(await fetch(base)).json();
if(!list.items?.length){alert("KeyDrop: No queued text in room "+r+". Send text from ClipDrop first.");return;}
const item=await(await fetch(base+"/"+list.items[0].id+"/claim",{method:"POST"})).json();
const setV=(e,v)=>{const p=e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(p,"value");d?.set?d.set.call(e,v):e.value=v;};
const ins=(e,c)=>{if(e.isContentEditable){const s=getSelection();if(s?.rangeCount){const g=s.getRangeAt(0);g.deleteContents();const n=c==="\\n"?document.createElement("br"):document.createTextNode(c);g.insertNode(n);g.setStartAfter(n);g.collapse(true);s.removeAllRanges();s.addRange(g);}else e.textContent+=c;e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:c}));return;}const a=e.selectionStart??e.value.length,b=e.selectionEnd??e.value.length;setV(e,e.value.slice(0,a)+c+e.value.slice(b));e.setSelectionRange?.(a+c.length,a+c.length);e.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:c}));};
if(item.mode==="instant"){ins(el,item.text);el.dispatchEvent(new Event("change",{bubbles:true}));return;}
for(const ch of Array.from(item.text)){el.dispatchEvent(new KeyboardEvent("keydown",{key:ch==="\\n"?"Enter":ch,bubbles:true}));ins(el,ch);el.dispatchEvent(new KeyboardEvent("keyup",{key:ch==="\\n"?"Enter":ch,bubbles:true}));if(item.speedMs>0)await new Promise(x=>setTimeout(x,item.speedMs));}
el.dispatchEvent(new Event("change",{bubbles:true}));
}catch(err){alert("KeyDrop failed: "+(err?.message||err));}
})();`;
  return "javascript:" + encodeURIComponent(code.replace(/\n+/g, ""));
}
