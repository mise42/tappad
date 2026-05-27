const statusEl = document.getElementById("status");
const reconnectButton = document.getElementById("reconnect");
const pad = document.getElementById("pad");
const textInput = document.getElementById("textInput");
const sendTextButton = document.getElementById("sendText");
const toggleKeysButton = document.getElementById("toggleKeys");
const keyDrawer = document.getElementById("keyDrawer");
const closeDrawerButton = document.getElementById("closeDrawer");
const releaseAllButton = document.getElementById("releaseAll");

const query = new URLSearchParams(window.location.search);
let ws;
let activePointers = new Map();
let lastTap = 0;
let pendingMove = { dx: 0, dy: 0 };
let moveFlushTimer = null;
let lastMoveTime = 0;
const MOVE_INTERVAL = 16;

let pendingWheel = 0;
let wheelFlushTimer = null;
let lastWheelTime = 0;
const WHEEL_INTERVAL = 24;

function socketUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const token = query.get("token");
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${window.location.host}/ws${suffix}`;
}

function setStatus(text, state) {
  statusEl.textContent = text;
  document.body.dataset.state = state;
}

function connect() {
  if (ws) ws.close();
  setStatus("Connecting", "connecting");
  ws = new WebSocket(socketUrl());
  ws.addEventListener("open", () => setStatus("Connected", "ready"));
  ws.addEventListener("close", () => setStatus("Disconnected", "closed"));
  ws.addEventListener("error", () => setStatus("Connection error", "error"));
}

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function flushMove() {
  moveFlushTimer = null;
  const now = performance.now();
  if (now - lastMoveTime < MOVE_INTERVAL) {
    moveFlushTimer = setTimeout(flushMove, MOVE_INTERVAL - (now - lastMoveTime));
    return;
  }
  const dx = pendingMove.dx;
  const dy = pendingMove.dy;
  pendingMove = { dx: 0, dy: 0 };
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    send({ type: "move", dx, dy });
    lastMoveTime = now;
  }
}

function queueMove(dx, dy) {
  pendingMove.dx += dx;
  pendingMove.dy += dy;
  if (!moveFlushTimer) {
    moveFlushTimer = setTimeout(flushMove, MOVE_INTERVAL);
  }
}

function flushWheel() {
  wheelFlushTimer = null;
  const now = performance.now();
  if (now - lastWheelTime < WHEEL_INTERVAL) {
    wheelFlushTimer = setTimeout(flushWheel, WHEEL_INTERVAL - (now - lastWheelTime));
    return;
  }
  const dy = pendingWheel;
  pendingWheel = 0;
  if (Math.abs(dy) > 0.5) {
    send({ type: "wheel", dy });
    lastWheelTime = now;
  }
}

function queueWheel(dy) {
  pendingWheel += dy;
  if (!wheelFlushTimer) {
    wheelFlushTimer = setTimeout(flushWheel, WHEEL_INTERVAL);
  }
}

function pointerSnapshot() {
  return Array.from(activePointers.values());
}

pad.addEventListener("pointerdown", (event) => {
  pad.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    startedAt: performance.now(),
  });
});

pad.addEventListener("pointermove", (event) => {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;
  const dx = event.clientX - pointer.lastX;
  const dy = event.clientY - pointer.lastY;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;

  const pointers = pointerSnapshot();
  if (pointers.length === 1) {
    queueMove(dx * 1.25, dy * 1.25);
  } else if (pointers.length === 2) {
    queueWheel(-dy * 0.25);
  }
});

function endPointer(event) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;
  activePointers.delete(event.pointerId);

  const duration = performance.now() - pointer.startedAt;
  const travel = Math.hypot(pointer.lastX - pointer.x, pointer.lastY - pointer.y);
  if (duration < 220 && travel < 10) {
    const now = performance.now();
    if (now - lastTap < 320) {
      send({ type: "click", button: "right" });
      lastTap = 0;
    } else {
      send({ type: "click", button: "left" });
      lastTap = now;
    }
  }
}

pad.addEventListener("pointerup", endPointer);
pad.addEventListener("pointercancel", endPointer);

const pressedKeys = new Set();

function pressKey(code) {
  if (pressedKeys.has(code)) return;
  pressedKeys.add(code);
  send({ type: "key", code, down: true });
}

function releaseKey(code) {
  if (!pressedKeys.has(code)) return;
  pressedKeys.delete(code);
  send({ type: "key", code, down: false });
}

function releaseAllKeys() {
  for (const code of pressedKeys) {
    send({ type: "key", code, down: false });
  }
  pressedKeys.clear();
  document.querySelectorAll("[data-key]").forEach((b) => b.classList.remove("pressed"));
}

document.querySelectorAll("[data-key]").forEach((button) => {
  const code = button.dataset.key;

  const onDown = (e) => {
    e.preventDefault();
    pressKey(code);
    button.classList.add("pressed");
  };

  const onUp = (e) => {
    e.preventDefault();
    releaseKey(code);
    button.classList.remove("pressed");
  };

  const onCancel = (e) => {
    e.preventDefault();
    releaseKey(code);
    button.classList.remove("pressed");
  };

  button.addEventListener("pointerdown", onDown);
  button.addEventListener("pointerup", onUp);
  button.addEventListener("pointercancel", onCancel);
  button.addEventListener("pointerleave", onCancel);
});

sendTextButton.addEventListener("click", () => {
  const value = textInput.value;
  if (!value.trim()) return;
  send({ type: "text", value });
  textInput.value = "";
});

textInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    sendTextButton.click();
  }
});

function openDrawer() {
  keyDrawer.classList.add("open");
  keyDrawer.setAttribute("aria-hidden", "false");
  toggleKeysButton.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  keyDrawer.classList.remove("open");
  keyDrawer.setAttribute("aria-hidden", "true");
  toggleKeysButton.setAttribute("aria-expanded", "false");
  releaseAllKeys();
}

toggleKeysButton.addEventListener("click", openDrawer);
closeDrawerButton.addEventListener("click", closeDrawer);
releaseAllButton.addEventListener("click", releaseAllKeys);

keyDrawer.querySelector(".drawer-backdrop").addEventListener("click", closeDrawer);

reconnectButton.addEventListener("click", connect);
window.addEventListener("pagehide", () => {
  releaseAllKeys();
  if (ws) ws.close();
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") releaseAllKeys();
});
connect();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}
