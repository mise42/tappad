const EV_KEY = 0x01;
const EV_REL = 0x02;
const REL_X = 0x00;
const REL_Y = 0x01;
const REL_WHEEL = 0x08;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;

const KEY_CODES = new Map(Object.entries({
  Escape: 1,
  Digit1: 2,
  Digit2: 3,
  Digit3: 4,
  Digit4: 5,
  Digit5: 6,
  Digit6: 7,
  Digit7: 8,
  Digit8: 9,
  Digit9: 10,
  Digit0: 11,
  Minus: 12,
  Equal: 13,
  Backspace: 14,
  Tab: 15,
  KeyQ: 16,
  KeyW: 17,
  KeyE: 18,
  KeyR: 19,
  KeyT: 20,
  KeyY: 21,
  KeyU: 22,
  KeyI: 23,
  KeyO: 24,
  KeyP: 25,
  BracketLeft: 26,
  BracketRight: 27,
  Enter: 28,
  ControlLeft: 29,
  ControlRight: 97,
  KeyA: 30,
  KeyS: 31,
  KeyD: 32,
  KeyF: 33,
  KeyG: 34,
  KeyH: 35,
  KeyJ: 36,
  KeyK: 37,
  KeyL: 38,
  Semicolon: 39,
  Quote: 40,
  Backquote: 41,
  ShiftLeft: 42,
  Backslash: 43,
  KeyZ: 44,
  KeyX: 45,
  KeyC: 46,
  KeyV: 47,
  KeyB: 48,
  KeyN: 49,
  KeyM: 50,
  Comma: 51,
  Period: 52,
  Slash: 53,
  ShiftRight: 54,
  AltLeft: 56,
  AltRight: 100,
  Space: 57,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
  Home: 102,
  ArrowUp: 103,
  PageUp: 104,
  ArrowLeft: 105,
  ArrowRight: 106,
  End: 107,
  ArrowDown: 108,
  PageDown: 109,
  Insert: 110,
  Delete: 111,
  MetaLeft: 125,
  MetaRight: 126
}));

const ASCII_KEY_CODES = new Map([
  ["\n", 28], ["\t", 15], [" ", 57],
  ["0", 11], ["1", 2], ["2", 3], ["3", 4], ["4", 5],
  ["5", 6], ["6", 7], ["7", 8], ["8", 9], ["9", 10],
  ["a", 30], ["b", 48], ["c", 46], ["d", 32], ["e", 18], ["f", 33],
  ["g", 34], ["h", 35], ["i", 23], ["j", 36], ["k", 37], ["l", 38],
  ["m", 50], ["n", 49], ["o", 24], ["p", 25], ["q", 16], ["r", 19],
  ["s", 31], ["t", 20], ["u", 22], ["v", 47], ["w", 17], ["x", 45],
  ["y", 21], ["z", 44],
  ["-", 12], ["=", 13], ["[", 26], ["]", 27], ["\\", 43],
  [";", 39], ["'", 40], ["`", 41], [",", 51], [".", 52], ["/", 53],
  ["!", 2], ["@", 3], ["#", 4], ["$", 5], ["%", 6],
  ["^", 7], ["&", 8], ["*", 9], ["(", 10], [")", 11],
  ["_", 12], ["+", 13], ["{", 26], ["}", 27], ["|", 43],
  [":", 39], ['"', 40], ["~", 41], ["<", 51], [">", 52], ["?", 53],
]);

const SHIFT_CHARS = new Set('!@#$%^&*()_+{}|:"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ');

export class InputDevice {
  constructor(adapter) {
    this.adapter = adapter;
  }

  move(dx, dy) {
    this.adapter.move(dx, dy);
  }

  click(button) {
    this.adapter.click(button);
  }

  key(code, down) {
    this.adapter.key(code, down);
  }

  type(text) {
    this.adapter.type(text);
  }

  scroll(dy) {
    this.adapter.scroll(dy);
  }
}

export class UinputAdapter {
  constructor(stream) {
    this.stream = stream;
  }

  move(dx, dy) {
    this._emit(EV_REL, REL_X, dx, false);
    this._emit(EV_REL, REL_Y, dy, true);
  }

  click(button) {
    const btnMap = { left: BTN_LEFT, right: BTN_RIGHT, middle: BTN_MIDDLE };
    const code = btnMap[button] ?? BTN_LEFT;
    this._emit(EV_KEY, code, 1, true);
    this._emit(EV_KEY, code, 0, true);
  }

  key(code, down) {
    const keyCode = KEY_CODES.get(code);
    if (keyCode !== undefined) {
      this._emit(EV_KEY, keyCode, down ? 1 : 0, true);
    }
  }

  type(text) {
    for (const ch of text) {
      const code = ASCII_KEY_CODES.get(ch);
      if (code === undefined) continue;
      const needShift = SHIFT_CHARS.has(ch);
      if (needShift) {
        this._emit(EV_KEY, 42, 1, true);
      }
      this._emit(EV_KEY, code, 1, true);
      this._emit(EV_KEY, code, 0, true);
      if (needShift) {
        this._emit(EV_KEY, 42, 0, true);
      }
    }
  }

  scroll(dy) {
    this._emit(EV_REL, REL_WHEEL, dy, true);
  }

  _emit(type, code, value, synReport = false) {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(type, 16);
    buf.writeUInt16LE(code, 18);
    buf.writeInt32LE(value, 20);
    this.stream.write(buf);
    if (synReport) {
      buf.writeUInt16LE(0x00, 16);
      buf.writeUInt16LE(0x00, 18);
      buf.writeInt32LE(0, 20);
      this.stream.write(buf);
    }
  }
}
