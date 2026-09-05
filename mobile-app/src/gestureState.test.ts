import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginGesture,
  centroid,
  shouldBeginWindowMode,
  shouldTap,
  TAP_MAX_TRAVEL,
} from './gestureState.ts';

test('stationary single touch can enter window mode', () => {
  const state = beginGesture({ x: 10, y: 10 }, 100);
  state.last = { x: 12, y: 14 };
  assert.equal(shouldBeginWindowMode(state), true);
});

test('travel and multi-touch prevent window mode', () => {
  const moved = beginGesture({ x: 0, y: 0 }, 100);
  moved.last = { x: TAP_MAX_TRAVEL + 1, y: 0 };
  assert.equal(shouldBeginWindowMode(moved), false);

  const multi = beginGesture({ x: 0, y: 0 }, 100);
  multi.maxTouches = 2;
  assert.equal(shouldBeginWindowMode(multi), false);
});

test('tap rejects long or moved gestures', () => {
  const tap = beginGesture({ x: 0, y: 0 }, 100);
  tap.last = { x: 3, y: 4 };
  assert.equal(shouldTap(tap, 250), true);
  assert.equal(shouldTap(tap, 400), false);

  tap.last = { x: 20, y: 0 };
  assert.equal(shouldTap(tap, 200), false);
});

test('centroid tracks two-finger scrolling without favoring either finger', () => {
  assert.deepEqual(centroid([{ x: 0, y: 10 }, { x: 10, y: 20 }]), { x: 5, y: 15 });
});
