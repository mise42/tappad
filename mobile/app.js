const statusEl = document.getElementById("status");
const reconnectButton = document.getElementById("reconnect");
const pad = document.getElementById("pad");
const textInput = document.getElementById("textInput");
const sendTextButton = document.getElementById("sendText");
const releaseAllButton = document.getElementById("releaseAll");
const rootStyle = document.documentElement.style;

const query = new URLSearchParams(window.location.search);
const actionCapabilities = window.__TAPPAD_ACTIONS__ || {};
let ws;
let activePointers = new Map();
let lastTapTime = 0;
let pendingMove = { dx: 0, dy: 0 };
let moveFlushTimer = null;
let lastMoveTime = 0;
const MOVE_INTERVAL = 8;
const DOUBLE_TAP_WINDOW = 320;
const DOUBLE_CLICK_GAP = 60;
const LONG_PRESS_DELAY = 520;

let pendingWheel = 0;
let wheelFlushTimer = null;
let lastWheelTime = 0;
const WHEEL_INTERVAL = 24;
const KEYBOARD_SHRINK_THRESHOLD = 90;
let viewportBaseline = { width: 0, height: 0 };

function isTextEntryActive() {
  return document.activeElement === textInput;
}

function currentViewportSize() {
  const viewport = window.visualViewport;
  return {
    width: Math.round(viewport?.width || window.innerWidth),
    height: Math.round(viewport?.height || window.innerHeight),
  };
}

function updateViewportBaseline(width, height) {
  const widthChanged = Math.abs(width - viewportBaseline.width) > 48;
  if (!viewportBaseline.height || widthChanged || height > viewportBaseline.height) {
    viewportBaseline = { width, height };
  }
}

function isViewportCompressed(height) {
  return viewportBaseline.height - height >= KEYBOARD_SHRINK_THRESHOLD;
}

function resizeTextInput() {
  const isCompressed = document.body.dataset.textEntry === "active";
  const viewportHeight = currentViewportSize().height;
  const minHeight = isCompressed ? 70 : 50;
  const maxHeight = isCompressed ? 92 : Math.min(190, Math.max(92, Math.round(viewportHeight * 0.34)));
  textInput.style.height = "auto";
  textInput.style.height = `${Math.min(Math.max(textInput.scrollHeight, minHeight), maxHeight)}px`;
}

function updateViewportSize() {
  const { width, height } = currentViewportSize();
  updateViewportBaseline(width, height);
  rootStyle.setProperty("--app-height", `${Math.round(height)}px`);
  document.body.dataset.textEntry =
    isTextEntryActive() && isViewportCompressed(height) ? "active" : "inactive";
  resizeTextInput();
}

function keepTextInputVisible() {
  updateViewportSize();
  requestAnimationFrame(() => {
    updateViewportSize();
    if (document.body.dataset.textEntry === "active") {
      textInput.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

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
  if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
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
  const pointer = {
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    startedAt: performance.now(),
    longPressed: false,
    longPressTimer: null,
  };
  pointer.longPressTimer = setTimeout(() => {
    const current = activePointers.get(event.pointerId);
    if (!current) return;
    const travel = Math.hypot(current.lastX - current.x, current.lastY - current.y);
    if (travel < 10 && pointerSnapshot().length === 1) {
      current.longPressed = true;
      send({ type: "click", button: "right" });
    }
  }, LONG_PRESS_DELAY);
  activePointers.set(event.pointerId, pointer);
});

function handlePointerMove(event) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;

  const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
  for (const sample of samples.length ? samples : [event]) {
    const dx = sample.clientX - pointer.lastX;
    const dy = sample.clientY - pointer.lastY;
    pointer.lastX = sample.clientX;
    pointer.lastY = sample.clientY;

    const pointers = pointerSnapshot();
    if (pointers.length === 1) {
      queueMove(dx * 1.25, dy * 1.25);
    } else if (pointers.length === 2) {
      queueWheel(-dy * 0.25);
    }
  }
}

pad.addEventListener(
  "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove",
  handlePointerMove,
);

function endPointer(event, canceled = false) {
  const pointer = activePointers.get(event.pointerId);
  if (!pointer) return;
  if (pointer.longPressTimer) clearTimeout(pointer.longPressTimer);
  activePointers.delete(event.pointerId);
  if (canceled) return;

  const duration = performance.now() - pointer.startedAt;
  const travel = Math.hypot(pointer.lastX - pointer.x, pointer.lastY - pointer.y);
  if (!pointer.longPressed && duration < 220 && travel < 10) {
    const now = performance.now();
    if (now - lastTapTime < DOUBLE_TAP_WINDOW) {
      setTimeout(
        () => send({ type: "click", button: "left", clickCount: 2 }),
        DOUBLE_CLICK_GAP,
      );
      lastTapTime = 0;
    } else {
      send({ type: "click", button: "left", clickCount: 1 });
      lastTapTime = now;
    }
  }
}

pad.addEventListener("pointerup", endPointer);
pad.addEventListener("pointercancel", (event) => endPointer(event, true));

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

function clearPendingTap() {
  lastTapTime = 0;
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
  resizeTextInput();
});

textInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    sendTextButton.click();
  }
});

textInput.addEventListener("focus", keepTextInputVisible);
textInput.addEventListener("input", keepTextInputVisible);
textInput.addEventListener("blur", () => {
  requestAnimationFrame(updateViewportSize);
});

// Tab switching
function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === "panel-" + tabName);
  });
  if (tabName !== "keys") {
    releaseAllKeys();
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

releaseAllButton.addEventListener("click", releaseAllKeys);

function ensureActionNotice() {
  let notice = document.getElementById("actionNotice");
  if (notice) return notice;

  notice = document.createElement("p");
  notice.id = "actionNotice";
  notice.style.margin = "12px 0 0";
  notice.style.color = "rgba(255,255,255,0.78)";
  notice.style.fontSize = "13px";
  const panel = document.querySelector("#panel-commands .panel-scroll");
  if (panel) panel.appendChild(notice);
  return notice;
}

function setActionNotice(text) {
  const notice = ensureActionNotice();
  notice.textContent = text;
}

// Command buttons
document.querySelectorAll("[data-cmd]").forEach((button) => {
  const action = button.dataset.cmd;
  const capability = actionCapabilities[action];

  if (capability?.state === "hidden") {
    button.remove();
    return;
  }

  if (capability?.state === "downgraded" && capability.note) {
    button.dataset.note = capability.note;
  }

  button.addEventListener("click", () => {
    if (button.dataset.note) {
      setActionNotice(button.dataset.note);
    } else {
      setActionNotice("");
    }
    send({ type: "cmd", action });
  });
});

reconnectButton.addEventListener("click", connect);
window.addEventListener("resize", updateViewportSize);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportSize);
  window.visualViewport.addEventListener("scroll", updateViewportSize);
}
window.addEventListener("pagehide", () => {
  clearPendingTap();
  releaseAllKeys();
  if (ws) ws.close();
});
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearPendingTap();
    releaseAllKeys();
  }
});
updateViewportSize();
connect();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}
