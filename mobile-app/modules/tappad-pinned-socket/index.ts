import { NativeModule, requireNativeModule } from 'expo';

type SocketEvent = { socketId: string };

type PinnedSocketEvents = {
  onOpen(event: SocketEvent): void;
  onMessage(event: SocketEvent & { data: string }): void;
  onClose(event: SocketEvent & { code: number }): void;
  onError(event: SocketEvent & { message: string; certificateMismatch: boolean }): void;
};

declare class PinnedSocketModule extends NativeModule<PinnedSocketEvents> {
  randomNonce(): string;
  probeFingerprint(host: string, port: number): Promise<string>;
  connect(socketId: string, url: string, fingerprint: string, authorization: string): void;
  send(socketId: string, text: string): boolean;
  close(socketId: string): void;
}

const native = requireNativeModule<PinnedSocketModule>('TapPadPinnedSocket');

export type PinnedSocketError = { message: string; certificateMismatch: boolean };

/** A random nonce for the token binding, from the platform's secure random source. */
export function randomNonce() {
  return native.randomNonce();
}

/**
 * Returns the fingerprint of the certificate the Host presents. Only for pairings that do not
 * have a fingerprint yet; the result is trusted only after the Host's bound proof checks out.
 */
export function probeFingerprint(host: string, port: number) {
  return native.probeFingerprint(host.replace(/^\[/, '').replace(/\]$/, ''), port);
}

let nextSocket = 0;

/** A WebSocket-shaped client that only talks to the Host certificate with `fingerprint`. */
export class PinnedWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = PinnedWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: PinnedSocketError) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  private readonly id = `tappad-${Date.now()}-${(nextSocket += 1)}`;
  private readonly subscriptions = [
    native.addListener('onOpen', ({ socketId }) => {
      if (socketId !== this.id || this.readyState !== PinnedWebSocket.CONNECTING) return;
      this.readyState = PinnedWebSocket.OPEN;
      this.onopen?.();
    }),
    native.addListener('onMessage', ({ socketId, data }) => {
      if (socketId === this.id && this.readyState === PinnedWebSocket.OPEN) this.onmessage?.({ data });
    }),
    native.addListener('onError', ({ socketId, message, certificateMismatch }) => {
      if (socketId === this.id && this.readyState !== PinnedWebSocket.CLOSED) {
        this.onerror?.({ message, certificateMismatch });
      }
    }),
    native.addListener('onClose', ({ socketId, code }) => {
      if (socketId === this.id) this.finish(code);
    }),
  ];

  constructor(url: string, fingerprint: string, authorization: string) {
    native.connect(this.id, url, fingerprint, authorization);
  }

  send(text: string) {
    return this.readyState === PinnedWebSocket.OPEN && native.send(this.id, text);
  }

  close() {
    if (this.readyState >= PinnedWebSocket.CLOSING) return;
    this.readyState = PinnedWebSocket.CLOSING;
    native.close(this.id);
    // Like a browser WebSocket, report the close asynchronously.
    setTimeout(() => this.finish(1000), 0);
  }

  private finish(code: number) {
    if (this.readyState === PinnedWebSocket.CLOSED) return;
    this.readyState = PinnedWebSocket.CLOSED;
    for (const subscription of this.subscriptions) subscription.remove();
    this.onclose?.({ code });
  }
}
