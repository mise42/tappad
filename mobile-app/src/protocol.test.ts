import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostStateActionCapabilities,
  releaseInputMessages,
  releaseMessages,
  readyActionCapabilities,
  serializeMessage,
  socketUrl,
  supportedWorkspaceActions,
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
    serializeMessage({ type: 'authorize', password: 'ascii only' }),
    '{"type":"authorize","password":"ascii only"}',
  );
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

test('Host Contract is authoritative when its version is understood', () => {
  const contract = {
    version: 1,
    protocolVersion: 2,
    inputCapabilities: { pointerButton: { state: 'supported' } },
    actionCapabilities: { screenshot: { state: 'supported' as const } },
  };

  assert.equal(supportsPointerButton({
    type: 'ready',
    protocolVersion: 1,
    inputCapabilities: { pointerButton: { state: 'unsupported' } },
    contract,
  }), true);
  assert.deepEqual(readyActionCapabilities({ type: 'ready', contract }), contract.actionCapabilities);
  assert.deepEqual(hostStateActionCapabilities({
    contract,
    actions: { screenshot: { state: 'unavailable' } },
  }), contract.actionCapabilities);
});

test('legacy and unknown Host Contracts degrade to existing capability fields', () => {
  const legacyActions = { screenshot: { state: 'supported' as const } };
  assert.deepEqual(hostStateActionCapabilities({ actions: legacyActions }), legacyActions);
  assert.deepEqual(hostStateActionCapabilities({
    contract: {
      version: 99,
      actionCapabilities: { screenshot: { state: 'unavailable' } },
    },
    actions: legacyActions,
  }), legacyActions);
  assert.equal(readyActionCapabilities({
    type: 'ready',
    contract: { version: 99, actionCapabilities: legacyActions },
  }), null);
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

test('workspace controls only include actions the Host supports', () => {
  assert.deepEqual(supportedWorkspaceActions(null), []);
  assert.deepEqual(supportedWorkspaceActions({
    'workspace.previous': { state: 'supported' },
    'workspace.former': { state: 'supported' },
    'workspace.next': { state: 'supported' },
    'workspace.1': { state: 'supported' },
    'workspace.2': { state: 'supported' },
    'workspace.3': { state: 'supported' },
    'workspace.4': { state: 'supported' },
    'workspace.5': { state: 'supported' },
    'workspace.6': { state: 'supported' },
  }), [
    { label: '1', action: 'workspace.1' },
    { label: '2', action: 'workspace.2' },
    { label: '3', action: 'workspace.3' },
    { label: '4', action: 'workspace.4' },
    { label: '5', action: 'workspace.5' },
  ]);
});
