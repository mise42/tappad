import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginGesture,
  centroid,
  recordPosition,
  shouldBeginDrag,
  shouldRightClick,
  shouldTap,
  TAP_MAX_TRAVEL,
} from './gestureState.ts';

test('a stationary press up to 400 ms is a tap, including the 220-350 ms range that used to be dropped', () => {
  const tap = beginGesture({ x: 0, y: 0 }, 100);
  recordPosition(tap, { x: 3, y: 4 });
  assert.equal(shouldTap(tap, 100 + 300), true);
  assert.equal(shouldTap(tap, 100 + 399), true);
  assert.equal(shouldTap(tap, 100 + 400), false);
});

test('travel past the tap slop is sticky even when the finger returns to where it started', () => {
  const gesture = beginGesture({ x: 0, y: 0 }, 100);
  recordPosition(gesture, { x: TAP_MAX_TRAVEL, y: 0 });
  recordPosition(gesture, { x: 1, y: 0 });
  assert.equal(gesture.moved, true);
  assert.equal(shouldTap(gesture, 150), false);
});

test('a resting or moving single finger never drags unless the touch follows a tap', () => {
  const plain = beginGesture({ x: 0, y: 0 }, 100);
  recordPosition(plain, { x: 40, y: 0 });
  assert.equal(shouldBeginDrag(plain), false);

  const afterTap = beginGesture({ x: 0, y: 0 }, 100, true);
  assert.equal(shouldBeginDrag(afterTap), true);
  afterTap.maxTouches = 2;
  assert.equal(shouldBeginDrag(afterTap), false);
});

test('a two-finger tap is a right click, a two-finger scroll is not', () => {
  const tap = beginGesture({ x: 0, y: 0 }, 100);
  tap.maxTouches = 2;
  tap.mode = 'scroll';
  tap.anchor = { x: 20, y: 0 };
  recordPosition(tap, { x: 22, y: 3 });
  // The last finger lifts after the other, leaving a single-finger tail.
  tap.mode = 'pointer';
  assert.equal(shouldRightClick(tap, 300), true);
  assert.equal(shouldTap(tap, 300), false);

  const scroll = beginGesture({ x: 0, y: 0 }, 100);
  scroll.maxTouches = 2;
  scroll.mode = 'scroll';
  scroll.anchor = { x: 20, y: 0 };
  recordPosition(scroll, { x: 20, y: 30 });
  assert.equal(shouldRightClick(scroll, 300), false);

  const three = beginGesture({ x: 0, y: 0 }, 100);
  three.maxTouches = 3;
  assert.equal(shouldRightClick(three, 300), false);
});

test('centroid tracks two-finger scrolling without favoring either finger', () => {
  assert.deepEqual(centroid([{ x: 0, y: 10 }, { x: 10, y: 20 }]), { x: 5, y: 15 });
});
