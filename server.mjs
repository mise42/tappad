#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildDesktopEnv } from "./lib/desktop-env.mjs";
import { InputDevice, UinputAdapter } from "./lib/input-device.mjs";
import { ClipboardGateway } from "./lib/clipboard-gateway.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, "static");

const host = process.env.TOUCHPAD_HOST ?? "0.0.0.0";
const port = Number(process.env.TOUCHPAD_PORT ?? "8765");
const token = process.env.TOUCHPAD_TOKEN ?? "";



const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

let pendingMove = { dx: 0, dy: 0 };
let moveTimer = null;
let pendingWheel = 0;
let wheelTimer = null;
const clients = new Set();
let activeClient = null;
let activeTimeout = null;

function setActiveClient(socket) {
  activeClient = socket;
  if (activeTimeout) clearTimeout(activeTimeout);
  activeTimeout = setTimeout(() => { activeClient = null; }, 2000);
}

function shouldHandle(message, socket) {
  if (message.type !== "move" && message.type !== "wheel") return true;
  if (!activeClient || activeClient === socket) return true;
  return false;
}

const uinputHelperPath = path.join(__dirname, "uinput-helper");
if (!fs.existsSync(uinputHelperPath)) {
  console.error("uinput-helper not found. Compile with: gcc uinput-helper.c -o uinput-helper");
  process.exit(1);
}

const uinputHelper = spawn(uinputHelperPath, [], {
  stdio: ["pipe", "ignore", "ignore"]
});

uinputHelper.on("error", (err) => {
  console.error("uinput-helper spawn error:", err.message);
  process.exit(1);
});

uinputHelper.on("exit", (code) => {
  console.error(`uinput-helper exited with code ${code}`);
  process.exit(1);
});

const runtimeEnv = buildDesktopEnv();
const uinputAdapter = new UinputAdapter(uinputHelper.stdin);
const inputDevice = new InputDevice(uinputAdapter);
const clipboardGateway = new ClipboardGateway({ env: runtimeEnv, inputDevice });

function flushMove() {
  moveTimer = null;
  const dx = Math.round(pendingMove.dx);
  const dy = Math.round(pendingMove.dy);
  pendingMove = { dx: 0, dy: 0 };
  if (dx || dy) {
    inputDevice.move(dx, dy);
  }
}

function flushWheel() {
  wheelTimer = null;
  const dy = Math.round(pendingWheel);
  pendingWheel = 0;
  if (dy) {
    inputDevice.scroll(dy);
  }
}

function dispatch(message, socket) {
  if (!shouldHandle(message, socket)) return;
  switch (message.type) {
    case "move":
      setActiveClient(socket);
      pendingMove.dx += Number(message.dx ?? 0);
      pendingMove.dy += Number(message.dy ?? 0);
      moveTimer ??= setTimeout(flushMove, 16);
      break;
    case "wheel":
      setActiveClient(socket);
      pendingWheel += Number(message.dy ?? 0);
      wheelTimer ??= setTimeout(flushWheel, 24);
      break;
    case "click":
      inputDevice.click(message.button);
      break;
    case "key":
      inputDevice.key(message.code, message.down);
      break;
    case "text":
      inputDevice.type(message.value);
      break;
    case "paste":
      clipboardGateway.paste(message.value);
      break;
    default:
      break;
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(staticDir, `.${pathname}`);
  if (!filePath.startsWith(staticDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found\n");
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": mimeTypes.get(ext) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function acceptValue(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function readFrame(socket, onMessage) {
  let buffer = Buffer.alloc(4096);
  let bufLen = 0;
  socket.on("error", () => undefined);
  socket.on("data", (chunk) => {
    if (bufLen + chunk.length > buffer.length) {
      const needed = Math.max(bufLen + chunk.length, buffer.length * 2);
      const next = Buffer.alloc(needed);
      buffer.copy(next, 0, 0, bufLen);
      buffer = next;
    }
    chunk.copy(buffer, bufLen);
    bufLen += chunk.length;

    let cursor = 0;
    while (bufLen - cursor >= 2) {
      const first = buffer[cursor];
      const second = buffer[cursor + 1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = cursor + 2;
      if (length === 126) {
        if (bufLen < offset + 2) { cursor = bufLen; break; }
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (bufLen < offset + 8) { cursor = bufLen; break; }
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      if (!masked || bufLen < offset + 4 + length) { cursor = bufLen; break; }
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.alloc(length);
      for (let index = 0; index < length; index += 1) {
        payload[index] = buffer[offset + index] ^ mask[index % 4];
      }
      cursor = offset + length;
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x1) onMessage(payload.toString("utf8"));
    }

    if (cursor > 0) {
      if (cursor < bufLen) {
        buffer.copy(buffer, 0, cursor, bufLen);
        bufLen -= cursor;
      } else {
        bufLen = 0;
      }
    }
  });
}

function send(socket, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  socket.write(Buffer.concat([header, data]));
}

const server = http.createServer(serveStatic);

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  if (token && url.searchParams.get("token") !== token) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${acceptValue(key)}`,
    "\r\n"
  ].join("\r\n"));
  clients.add(socket);
  console.log(`client connected, total clients: ${clients.size}`);
  send(socket, { type: "ready", host: os.hostname(), time: Date.now() });
  readFrame(socket, (raw) => {
    try {
      dispatch(JSON.parse(raw), socket);
    } catch {
      send(socket, { type: "error", message: "invalid message" });
    }
  });
  socket.on("close", () => {
    clients.delete(socket);
    console.log(`client disconnected, total clients: ${clients.size}`);
  });
  socket.on("error", () => {
    clients.delete(socket);
    console.log(`client error, total clients: ${clients.size}`);
  });
});

server.listen(port, host, () => {
  console.log(`touchpad listening on http://${host}:${port}`);
  if (token) console.log("auth token enabled");
});
