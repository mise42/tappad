import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestFrameCoalescer, type FrameScheduler } from './frameCoalescer.ts';

function manualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const canceled: number[] = [];
  const scheduler: FrameScheduler = {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
      canceled.push(handle);
    },
  };

  return {
    scheduler,
    canceled,
    pendingCount: () => callbacks.size,
    runNext() {
      const entry = callbacks.entries().next().value as [number, () => void] | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
}

test('coalesces updates to the latest value once per frame', () => {
  const frames = manualScheduler();
  const emitted: number[] = [];
  const coalescer = createLatestFrameCoalescer((value: number) => emitted.push(value), frames.scheduler);

  coalescer.push(1);
  coalescer.push(2);
  coalescer.push(3);

  assert.equal(frames.pendingCount(), 1);
  frames.runNext();
  assert.deepEqual(emitted, [3]);

  coalescer.push(4);
  frames.runNext();
  assert.deepEqual(emitted, [3, 4]);
});

test('cancel drops a pending value so scrolling cannot continue after gesture end', () => {
  const frames = manualScheduler();
  const emitted: number[] = [];
  const coalescer = createLatestFrameCoalescer((value: number) => emitted.push(value), frames.scheduler);

  coalescer.push(8);
  coalescer.cancel();
  frames.runNext();

  assert.deepEqual(emitted, []);
  assert.deepEqual(frames.canceled, [1]);
  assert.equal(frames.pendingCount(), 0);
});
