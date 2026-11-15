import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { bindingAuthorization, hmacSha256, sha256, verifyHostProof } from './host-binding.ts';

const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/native-host.json', import.meta.url), 'utf8'));
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

test('SHA-256 and HMAC match Node crypto across block boundaries', () => {
  // 55/56/64 bytes straddle the padding edge cases; the long key exercises key hashing.
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
    const data = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 0xff);
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'), `sha256 ${length}`);
    const key = new Uint8Array(length % 100).map((_, i) => i);
    assert.equal(hex(hmacSha256(key, data)), createHmac('sha256', key).update(data).digest('hex'), `hmac ${length}`);
  }
  const longKey = new Uint8Array(130).fill(9);
  assert.equal(hex(hmacSha256(longKey, new Uint8Array([1]))), createHmac('sha256', longKey).update(new Uint8Array([1])).digest('hex'));
});

test('the binding header and host proof match the Rust Host fixture', () => {
  const { token, fingerprint, nonce, clientProof, hostProof } = fixture.binding;
  assert.equal(bindingAuthorization(token, fingerprint, nonce), `TapPad-Binding ${nonce}.${clientProof}`);
  assert.equal(verifyHostProof(token, fingerprint, nonce, hostProof), true);
});

test('a host proof for another certificate, token or nonce is rejected', () => {
  const { token, fingerprint, nonce, clientProof, hostProof } = fixture.binding;
  assert.equal(verifyHostProof(token, 'cd'.repeat(32), nonce, hostProof), false);
  assert.equal(verifyHostProof('other-token', fingerprint, nonce, hostProof), false);
  assert.equal(verifyHostProof(token, fingerprint, 'another-nonce-value-xx', hostProof), false);
  // Reflecting the app's own proof back must not pass as the Host's.
  assert.equal(verifyHostProof(token, fingerprint, nonce, clientProof), false);
  assert.equal(verifyHostProof(token, fingerprint, nonce, undefined), false);
});
