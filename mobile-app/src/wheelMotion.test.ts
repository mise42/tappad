import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COAST_STOP_SPEED,
  COAST_TIME_CONSTANT_MS,
  createWheelMotion,
  type FrameScheduler,
} from './wheelMotion.ts';

function harness() {
  let nextHandle = 1;
  let clock = 0;
  const callbacks = new Map<number, () => void>();
  const emitted: number[] = [];
  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  };
  const wheel = createWheelMotion((dy) => emitted.push(dy), scheduler, () => clock);

  return {
    wheel,
    emitted,
    pending: () => callbacks.size,
    advance(ms: number) {
      clock += ms;
    },
    // Advance one 60 Hz frame and run it.
    frame() {
      clock += 16;
      const entry = callbacks.entries().next().value as [number, () => void] | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
}

test('sums movement within a frame and carries the fraction into later frames', () => {
  const h = harness();
  h.wheel.push(0.4);
  h.wheel.push(0.4);
  h.wheel.push(0.4);
  assert.equal(h.pending(), 1);
  h.frame();
  assert.deepEqual(h.emitted, [1]);

  // 0.2 carried over plus 0.9 makes a whole unit; rounding each frame alone would send nothing.
  h.wheel.push(0.9);
  h.frame();
  assert.deepEqual(h.emitted, [1, 1]);
});

test('slow scrolling upward still moves, truncating toward zero', () => {
  const h = harness();
  for (let i = 0; i < 4; i += 1) {
    h.wheel.push(-0.3);
    h.frame();
  }
  assert.deepEqual(h.emitted, [-1]);
});

test('a fast release coasts in the same direction, slows down, and stops', () => {
  const h = harness();
  // 6 wheel units per 16 ms frame, upward.
  for (let i = 0; i < 6; i += 1) {
    h.wheel.push(-6);
    h.frame();
  }
  const fingerTotal = h.emitted.reduce((sum, dy) => sum + dy, 0);
  h.emitted.length = 0;

  h.wheel.release();
  let frames = 0;
  while (h.pending() && frames < 1000) {
    h.frame();
    frames += 1;
  }

  assert.equal(fingerTotal, -36);
  assert.equal(h.pending(), 0, 'coast must end on its own');
  assert.ok(h.emitted.length > 5, 'coast should last several frames');
  assert.ok(h.emitted.every((dy) => dy < 0), 'coast keeps the scroll direction');
  assert.ok(Math.abs(h.emitted[0]) >= Math.abs(h.emitted[h.emitted.length - 1]), 'coast slows down');
  const speed = 6 / 16;
  const coastTotal = -h.emitted.reduce((sum, dy) => sum + dy, 0);
  // Exponential decay from the release speed covers about speed × τ, minus the tail below the stop speed.
  const expected = (speed - COAST_STOP_SPEED) * COAST_TIME_CONSTANT_MS;
  assert.ok(Math.abs(coastTotal - expected) <= 3, `coasted ${coastTotal}, expected about ${expected}`);
});

test('fingers that rest before lifting do not coast', () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) {
    h.wheel.push(6);
    h.frame();
  }
  h.advance(80);
  h.emitted.length = 0;
  h.wheel.release();
  h.frame();
  assert.deepEqual(h.emitted, []);
  assert.equal(h.pending(), 0);
});

test('a slow release does not coast', () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) {
    h.wheel.push(0.5);
    h.frame();
  }
  h.emitted.length = 0;
  h.wheel.release();
  h.frame();
  assert.deepEqual(h.emitted, []);
  assert.equal(h.pending(), 0);
});

test('stop ends a coast at once and reports that one was running', () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) {
    h.wheel.push(6);
    h.frame();
  }
  h.wheel.release();
  h.frame();
  assert.equal(h.wheel.stop(), true);
  const sent = h.emitted.length;
  h.frame();
  assert.equal(h.emitted.length, sent);
  assert.equal(h.pending(), 0);
  assert.equal(h.wheel.stop(), false);
});

test('new finger movement replaces a coast instead of adding to it', () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) {
    h.wheel.push(6);
    h.frame();
  }
  h.wheel.release();
  h.frame();
  h.emitted.length = 0;
  h.wheel.push(-2);
  h.frame();
  h.frame();
  assert.deepEqual(h.emitted, [-2]);
  assert.equal(h.pending(), 0);
});
