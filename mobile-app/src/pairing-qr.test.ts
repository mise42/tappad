import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePairingQrData } from './pairing-qr.ts';

const token = 'abcdefghijklmnopqrstuv';
const hosts = ['192.168.100.126', 'tappad-host-id.local.', 'fe80::1234'];

test('accepts the Desktop Host LAN pairing URL', () => {
  assert.deepEqual(parsePairingQrData(`http://192.168.100.126:8765/?token=${token}`, hosts, 8765), {
    ok: true,
    token,
  });
});

test('accepts the selected host local alias and IPv6 address', () => {
  assert.equal(parsePairingQrData(`http://tappad-host-id.local:8765/?token=${token}`, hosts, 8765).ok, true);
  assert.equal(parsePairingQrData(`http://[fe80::1234]:8765/?token=${token}`, hosts, 8765).ok, true);
});

test('rejects a QR code for another host or port', () => {
  assert.deepEqual(parsePairingQrData(`http://192.168.100.127:8765/?token=${token}`, hosts, 8765), {
    ok: false,
    error: 'This QR code does not match the selected TapPad host.',
  });
  assert.deepEqual(parsePairingQrData(`http://192.168.100.126:9999/?token=${token}`, hosts, 8765), {
    ok: false,
    error: 'This QR code belongs to a different TapPad host port.',
  });
});

test('rejects non-local link shapes and ambiguous payloads', () => {
  assert.equal(parsePairingQrData(`https://192.168.100.126:8765/?token=${token}`, hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(`http://192.168.100.126:8765/control?token=${token}`, hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(`http://192.168.100.126:8765/?token=${token}&next=elsewhere`, hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(`http://192.168.100.126:8765/?token=${token}&token=${token}`, hosts, 8765).ok, false);
});

test('accepts a custom URL-safe token and rejects missing or malformed tokens', () => {
  assert.deepEqual(parsePairingQrData('http://192.168.100.126:8765/?token=pair-token', hosts, 8765), {
    ok: true,
    token: 'pair-token',
  });
  assert.equal(parsePairingQrData('http://192.168.100.126:8765/', hosts, 8765).ok, false);
  assert.equal(parsePairingQrData(`http://192.168.100.126:8765/?token=${token}%20`, hosts, 8765).ok, false);
});
