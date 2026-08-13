import assert from 'node:assert/strict';
import test from 'node:test';

import {
  releaseInputMessages,
  releaseMessages,
  serializeMessage,
  socketUrl,
  supportsPointerButton,
} from './protocol.ts';

test('stable protocol messages keep their existing JSON shapes', () => {
  assert.equal(serializeMessage({ type: 'move', dx: 2.5, dy: -1 }), '{"type":"move","dx":2.5,"dy":-1}');
  assert.equal(
    serializeMessage({ type: 'click', button: 'left', clickCount: 2 }),
    '{"type":"click","button":"left","clickCount":2}',
  );
  assert.equal(serializeMessage({ type: 'cmd', action: 'media.play_pause' }), '{"type":"cmd","action":"media.play_pause"}');
  assert.equal(
    serializeMessage({ type: 'pointerButton', button: 'left', down: true }),
    '{"type":"pointerButton","button":"left","down":true}',
  );
});

test('release cleanup puts pointer buttons before held keys', () => {
  assert.deepEqual(releaseInputMessages(['left'], ['MetaLeft']), [
    { type: 'pointerButton', button: 'left', down: false },
    { type: 'key', code: 'MetaLeft', down: false },
  ]);
});

test('pointer button requires the versioned Host capability', () => {
  assert.equal(supportsPointerButton({ type: 'ready' }), false);
  assert.equal(supportsPointerButton({
    type: 'ready',
    protocolVersion: 2,
    inputCapabilities: { pointerButton: { state: 'supported' } },
  }), true);
  assert.equal(supportsPointerButton({
    type: 'ready',
    protocolVersion: 2,
    inputCapabilities: { pointerButton: { state: 'unsupported' } },
  }), false);
});

test('release cleanup emits one key-up per held key', () => {
  assert.deepEqual(releaseMessages(new Set(['MetaLeft', 'ShiftLeft'])), [
    { type: 'key', code: 'MetaLeft', down: false },
    { type: 'key', code: 'ShiftLeft', down: false },
  ]);
});

test('pairing token is encoded in the existing websocket URL', () => {
  assert.equal(socketUrl('192.168.1.2', 8765, 'a b&c'), 'ws://192.168.1.2:8765/ws?token=a%20b%26c');
});
