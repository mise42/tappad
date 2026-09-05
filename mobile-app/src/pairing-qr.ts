export type PairingQrResult =
  | { ok: true; token: string }
  | { ok: false; error: string };

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export function parsePairingQrData(
  data: string,
  allowedHosts: readonly string[],
  expectedPort: number,
): PairingQrResult {
  let url: URL;
  try {
    url = new URL(data.trim());
  } catch {
    return { ok: false, error: 'This is not a valid TapPad pairing QR code.' };
  }

  if (url.protocol !== 'http:' || url.username || url.password || url.hash || url.pathname !== '/') {
    return { ok: false, error: 'This QR code is not a local TapPad pairing link.' };
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port !== expectedPort) {
    return { ok: false, error: 'This QR code belongs to a different TapPad host port.' };
  }

  const normalizedHosts = new Set(allowedHosts.map(normalizeHost).filter(Boolean));
  if (!normalizedHosts.has(normalizeHost(url.hostname))) {
    return { ok: false, error: 'This QR code does not match the selected TapPad host.' };
  }

  const entries = Array.from(url.searchParams.entries());
  const tokens = url.searchParams.getAll('token');
  if (entries.length !== 1 || tokens.length !== 1) {
    return { ok: false, error: 'This QR code has an invalid TapPad pairing payload.' };
  }

  const token = tokens[0];
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(token)) {
    return { ok: false, error: 'This QR code contains an invalid TapPad pairing token.' };
  }

  return { ok: true, token };
}
