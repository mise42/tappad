import assert from 'node:assert/strict';
import test from 'node:test';

import { keyboardInsetFromFrame } from './keyboard-insets.ts';

test('uses the live keyboard frame without double-counting the bottom safe area', () => {
  assert.equal(keyboardInsetFromFrame(800, 480, 24), 296);
  assert.equal(keyboardInsetFromFrame(800, 600, 24), 176);
});

test('does not add an inset when the keyboard is hidden or the window is already resized', () => {
  assert.equal(keyboardInsetFromFrame(800, null, 24), 0);
  assert.equal(keyboardInsetFromFrame(480, 480, 24), 0);
});
