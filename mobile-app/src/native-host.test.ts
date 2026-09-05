import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parsePairingQrData } from './pairing-qr.ts';
import { serializeMessage, socketUrl, supportsPointerButton, supportsTextSubmit } from './protocol.ts';
import { authorizationResultNotice } from './authorization.ts';
import { verifyHostProof } from './host-binding.ts';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/native-host.json', import.meta.url), 'utf8'));

test('native scanner and connection use the headless Host pairing contract', () => {
  const parsed = parsePairingQrData(fixture.pairingUrl, [fixture.host], fixture.port);
  assert.deepEqual(parsed, { ok: true, token: 'pair-token', fingerprint: fixture.fingerprint });
  if (!parsed.ok) throw new Error(parsed.error);
  assert.equal(socketUrl(fixture.host, fixture.port), 'wss://tappad-host-id.local:8765/ws');
  assert.equal(parsePairingQrData(fixture.pairingUrl, ['another-host.local'], fixture.port).ok, false);
  assert.equal(supportsPointerButton(fixture.ready), true);
  assert.equal(verifyHostProof(parsed.token, parsed.fingerprint, fixture.binding.nonce, fixture.ready.hostProof), true);
});

test('send and Enter is one text message gated by the Host textSubmit capability', () => {
  assert.equal(supportsTextSubmit(fixture.ready), true);
  assert.equal(supportsTextSubmit({ type: 'ready', protocolVersion: 2, contract: { version: 1, protocolVersion: 2, inputCapabilities: {} } }), false);
  assert.deepEqual(JSON.parse(serializeMessage({ type: 'text', value: '你好', submit: true })), fixture.textSubmit);
});

test('native authorization uses the same message and submission semantics as Rust', () => {
  assert.deepEqual(JSON.parse(serializeMessage({ type: 'authorize', password: 'fixture-only' })), fixture.authorization);
  assert.equal(authorizationResultNotice(fixture.result.status, fixture.result.message), 'Submitted');
});
