const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type PairingQrResult =
  | { ok: true; token: string; fingerprint: string }
  | { ok: false; error: string };

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

/**
 * Parses `https://<host>:<port>/#token=<token>&fp=<sha256>`. The fragment keeps the credentials
 * out of any request a browser makes; `fp` is the Host certificate the app pins.
 */
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

  if (url.protocol === 'http:') {
    return { ok: false, error: 'This QR code is from an older TapPad Host. Update the Host to pair securely.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.pathname !== '/') {
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

  const fields = new URLSearchParams(url.hash.slice(1));
  const entries = Array.from(fields.entries());
  const tokens = fields.getAll('token');
  const fingerprints = fields.getAll('fp');
  if (entries.length !== 2 || tokens.length !== 1 || fingerprints.length !== 1) {
    return { ok: false, error: 'This QR code has an invalid TapPad pairing payload.' };
  }

  const token = tokens[0];
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(token)) {
    return { ok: false, error: 'This QR code contains an invalid TapPad pairing token.' };
  }
  const fingerprint = fingerprints[0];
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    return { ok: false, error: 'This QR code contains an invalid TapPad certificate fingerprint.' };
  }

  return { ok: true, token, fingerprint };
}
