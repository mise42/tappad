const assert = require("node:assert/strict");
const test = require("node:test");

const MobileInputController = require("../static/mobile-input-controller.js");

class FakeScheduler {
  constructor() {
    this.time = 1000;
    this.nextId = 1;
    this.timers = new Map();
  }

  now() {
    return this.time;
  }

  setTimeout(callback, delay) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { callback, dueAt: this.time + delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  tick(ms) {
    const end = this.time + ms;
    while (true) {
      const next = Array.from(this.timers.entries())
        .filter(([, timer]) => timer.dueAt <= end)
        .sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
      if (!next) break;
      const [id, timer] = next;
      this.time = timer.dueAt;
      this.timers.delete(id);
      timer.callback();
    }
    this.time = end;
  }
}

function createController() {
  const scheduler = new FakeScheduler();
  const messages = [];
  const controller = new MobileInputController({
    send: (message) => messages.push(message),
    now: () => scheduler.now(),
    setTimeout: (callback, delay) => scheduler.setTimeout(callback, delay),
    clearTimeout: (id) => scheduler.clearTimeout(id),
  });

  return { controller, scheduler, messages };
}

function pointerEvent(pointerId, clientX, clientY) {
  return { pointerId, clientX, clientY };
}

test("short tap sends a left click", () => {
  const { controller, scheduler, messages } = createController();

  controller.pointerDown(pointerEvent(1, 20, 30));
  scheduler.tick(80);
  controller.pointerUp(pointerEvent(1, 20, 30));

  assert.deepEqual(messages, [{ type: "click", button: "left", clickCount: 1 }]);
});

test("double tap preserves existing delayed double-click behavior", () => {
  const { controller, scheduler, messages } = createController();

  controller.pointerDown(pointerEvent(1, 0, 0));
  scheduler.tick(50);
  controller.pointerUp(pointerEvent(1, 0, 0));
  scheduler.tick(100);
  controller.pointerDown(pointerEvent(2, 0, 0));
  scheduler.tick(50);
  controller.pointerUp(pointerEvent(2, 0, 0));
  scheduler.tick(59);

  assert.deepEqual(messages, [{ type: "click", button: "left", clickCount: 1 }]);

  scheduler.tick(1);
  assert.deepEqual(messages, [
    { type: "click", button: "left", clickCount: 1 },
    { type: "click", button: "left", clickCount: 2 },
  ]);
});

test("long press sends right click and suppresses tap on release", () => {
  const { controller, scheduler, messages } = createController();

  controller.pointerDown(pointerEvent(1, 12, 18));
  scheduler.tick(520);
  controller.pointerUp(pointerEvent(1, 12, 18));

  assert.deepEqual(messages, [{ type: "click", button: "right" }]);
});

test("one-finger movement is coalesced into a move intent", () => {
  const { controller, scheduler, messages } = createController();

  controller.pointerDown(pointerEvent(1, 10, 10));
  controller.pointerMove(pointerEvent(1, 14, 18));
  scheduler.tick(8);

  assert.deepEqual(messages, [{ type: "move", dx: 5, dy: 10 }]);
});

test("two-finger movement is coalesced into a wheel intent", () => {
  const { controller, scheduler, messages } = createController();

  controller.pointerDown(pointerEvent(1, 0, 0));
  controller.pointerDown(pointerEvent(2, 0, 10));
  controller.pointerMove(pointerEvent(2, 0, 18));
  scheduler.tick(24);

  assert.deepEqual(messages, [{ type: "wheel", dy: -2 }]);
});

test("release all sends key-up for every pressed key once", () => {
  const { controller, messages } = createController();

  assert.equal(controller.pressKey("MetaLeft"), true);
  assert.equal(controller.pressKey("MetaLeft"), false);
  assert.equal(controller.pressKey("KeyC"), true);
  assert.deepEqual(controller.releaseAllKeys(), ["MetaLeft", "KeyC"]);

  assert.deepEqual(messages, [
    { type: "key", code: "MetaLeft", down: true },
    { type: "key", code: "KeyC", down: true },
    { type: "key", code: "MetaLeft", down: false },
    { type: "key", code: "KeyC", down: false },
  ]);
  assert.deepEqual(controller.releaseAllKeys(), []);
});
