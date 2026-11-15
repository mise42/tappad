import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePairingQrData } from './pairing-qr.ts';

const token = 'abcdefghijklmnopqrstuv';
const fp = '0123456789abcdef'.repeat(4);
const hosts = ['192.168.100.126', 'tappad-host-id.local.', 'fe80::1234'];
const link = (host: string, fragment = `token=${token}&fp=${fp}`) => `https://${host}:8765/#${fragment}`;

test('accepts the Desktop Host LAN pairing URL with its certificate fingerprint', () => {
  assert.deepEqual(parsePairingQrData(link('192.168.100.126'), hosts, 8765), { ok: true, token, fingerprint: fp });
  assert.deepEqual(parsePairingQrData(link('192.168.100.126', `fp=${fp}&token=${token}`), hosts, 8765), {
    ok: true,
    token,
    fingerprint: fp,
  });
});

test('accepts the selected host local alias and IPv6 address', () => {
  assert.equal(parsePairingQrData(link('tappad-host-id.local'), hosts, 8765).ok, true);
  assert.equal(parsePairingQrData(link('[fe80::1234]'), hosts, 8765).ok, true);
});

test('rejects a QR code for another host or port', () => {
  assert.deepEqual(parsePairingQrData(link('192.168.100.127'), hosts, 8765), {
    ok: false,
    error: 'This QR code does not match the selected TapPad host.',
  });
  assert.equal(parsePairingQrData(`https://192.168.100.126:9999/#token=${token}&fp=${fp}`, hosts, 8765).ok, false);
});

test('rejects plaintext, query-string credentials and ambiguous payloads', () => {
  // The pre-TLS shape: credentials in the query would reach the network in clear text.
  const legacy = parsePairingQrData(`http://192.168.100.126:8765/?token=${token}`, hosts, 8765);
  assert.equal(legacy.ok, false);
  assert.match(legacy.ok ? '' : legacy.error, /older TapPad Host/);
  assert.equal(parsePairingQrData(`https://192.168.100.126:8765/?token=${token}#token=${token}&fp=${fp}`, hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(`https://192.168.100.126:8765/control#token=${token}&fp=${fp}`, hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}&fp=${fp}&next=x`), hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}&token=${token}&fp=${fp}`), hosts, 8765).ok, false);
});

test('requires a well-formed token and a lowercase SHA-256 fingerprint', () => {
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}`), hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}%20&fp=${fp}`), hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}&fp=${fp.toUpperCase()}`), hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(link('192.168.100.126', `token=${token}&fp=${fp.slice(1)}`), hosts, 8765).ok, false);
});
