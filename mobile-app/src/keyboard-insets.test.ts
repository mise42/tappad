import assert from 'node:assert/strict';
import test from 'node:test';

import { keyboardInset } from './keyboard-insets.ts';

test('uses the Android IME height as reported, since it already excludes the navigation bar', () => {
  assert.equal(keyboardInset('android', 296, 48), 296);
  // A voice input panel that grows while the keyboard stays visible raises the inset with it.
  assert.equal(keyboardInset('android', 412, 48), 412);
});

test('removes the home indicator area from the iOS keyboard frame', () => {
  assert.equal(keyboardInset('ios', 336, 34), 302);
  assert.equal(keyboardInset('ios', 20, 34), 0);
});

test('does not add an inset when the keyboard is hidden', () => {
  assert.equal(keyboardInset('android', null, 48), 0);
  assert.equal(keyboardInset('ios', null, 34), 0);
});
