const statusEl = document.getElementById("status");
const reconnectButton = document.getElementById("reconnect");
const pad = document.getElementById("pad");
const textInput = document.getElementById("textInput");
const sendTextButton = document.getElementById("sendText");
const releaseAllButton = document.getElementById("releaseAll");

const query = new URLSearchParams(window.location.search);
let ws;

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

const controller = new MobileInputController({
  send,
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
});

pad.addEventListener("pointerdown", (event) => {
  pad.setPointerCapture(event.pointerId);
  controller.pointerDown(event);
});

pad.addEventListener(
  "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove",
  (event) => controller.pointerMove(event),
);

pad.addEventListener("pointerup", (event) => controller.pointerUp(event));
pad.addEventListener("pointercancel", (event) => controller.pointerCancel(event));

function releaseAllKeys() {
  controller.releaseAllKeys();
  document.querySelectorAll("[data-key]").forEach((b) => b.classList.remove("pressed"));
}

function clearPendingTap() {
  controller.clearPendingTap();
}

document.querySelectorAll("[data-key]").forEach((button) => {
  const code = button.dataset.key;

  const onDown = (e) => {
    e.preventDefault();
    if (controller.pressKey(code)) {
      button.classList.add("pressed");
    }
  };

  const onUp = (e) => {
    e.preventDefault();
    if (controller.releaseKey(code)) {
      button.classList.remove("pressed");
    }
  };

  const onCancel = (e) => {
    e.preventDefault();
    if (controller.releaseKey(code)) {
      button.classList.remove("pressed");
    }
  };

  button.addEventListener("pointerdown", onDown);
  button.addEventListener("pointerup", onUp);
  button.addEventListener("pointercancel", onCancel);
  button.addEventListener("pointerleave", onCancel);
});

sendTextButton.addEventListener("click", () => {
  const value = textInput.value;
  if (controller.sendText(value)) {
    textInput.value = "";
  }
});

textInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    sendTextButton.click();
  }
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

// Command buttons
document.querySelectorAll("[data-cmd]").forEach((button) => {
  button.addEventListener("click", () => {
    controller.sendCommand(button.dataset.cmd);
  });
});

reconnectButton.addEventListener("click", connect);
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
connect();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js");
}
