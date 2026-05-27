import { spawn } from "node:child_process";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClipboardGateway {
  constructor({ env, inputDevice }) {
    this.env = env;
    this.inputDevice = inputDevice;
    this.queue = Promise.resolve();
  }

  paste(value) {
    const text = String(value ?? "").slice(0, 12000);
    if (!text) return;
    console.log(`paste request: ${text.length} chars, first 30: ${text.slice(0, 30)}`);

    this.queue = this.queue
      .then(() => this._setClipboard(text))
      .then((ok) => {
        if (!ok) {
          console.warn("clipboard copy failed, skipping paste");
          return;
        }
        return delay(250).then(() => this._sendPasteShortcut());
      })
      .catch((err) => {
        console.warn("paste pipeline error:", err?.message || err);
      });
  }

  _setClipboard(input) {
    return new Promise((resolve) => {
      const child = spawn("wl-copy", ["--type", "text/plain;charset=utf-8"], {
        env: this.env,
        stdio: ["pipe", "ignore", "ignore"]
      });
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      child.on("error", (error) => {
        console.warn(`wl-copy failed: ${error.message}`);
        finish(false);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          console.warn(`wl-copy failed (exit ${code})`);
          finish(false);
        } else {
          finish(true);
        }
      });
      child.stdin.end(input, "utf-8");
      setTimeout(() => {
        if (!settled) {
          console.warn("wl-copy timeout, killing");
          child.kill();
          finish(false);
        }
      }, 2000);
    });
  }

  async _sendPasteShortcut() {
    this.inputDevice.key("ControlLeft", true);
    this.inputDevice.key("KeyV", true);
    await delay(35);
    this.inputDevice.key("KeyV", false);
    await delay(35);
    this.inputDevice.key("ControlLeft", false);
  }
}
