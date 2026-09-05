import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parsePairingQrData } from './pairing-qr.ts';
import { serializeMessage, socketUrl, supportsPointerButton } from './protocol.ts';
import { authorizationResultNotice } from './authorization.ts';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/native-host.json', import.meta.url), 'utf8'));

test('native scanner and connection use the headless Host pairing contract', () => {
  const parsed = parsePairingQrData(fixture.pairingUrl, [fixture.host], fixture.port);
  assert.deepEqual(parsed, { ok: true, token: 'pair-token' });
  if (!parsed.ok) throw new Error(parsed.error);
  assert.equal(socketUrl(fixture.host, fixture.port, parsed.token), 'ws://tappad-host-id.local:8765/ws?token=pair-token');
  assert.equal(parsePairingQrData(fixture.pairingUrl, ['another-host.local'], fixture.port).ok, false);
  assert.equal(supportsPointerButton(fixture.ready), true);
});

test('native authorization uses the same message and submission semantics as Rust', () => {
  assert.deepEqual(JSON.parse(serializeMessage({ type: 'authorize', password: 'fixture-only' })), fixture.authorization);
  assert.equal(authorizationResultNotice(fixture.result.status, fixture.result.message), '已提交');
});
