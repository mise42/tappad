export type TapPadMessage =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wheel'; dy: number }
  | { type: 'click'; button: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'text'; value: string }
  | { type: 'paste'; value: string }
  | { type: 'cmd'; action: string };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export type CapabilityState = 'supported' | 'downgraded' | 'deferred' | 'hidden';

export type ActionCapability = {
  state: CapabilityState;
  note?: string;
};

export type ActionCapabilities = Record<string, ActionCapability>;

export type HostState = {
  actions?: ActionCapabilities;
};

export const RELEASABLE_KEYS = [
  'Escape', 'Tab', 'Enter', 'Backspace', 'PrintScreen',
  'MetaLeft', 'ControlLeft', 'ShiftLeft', 'AltLeft', 'Space',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyB', 'KeyS', 'KeyT', 'KeyW', 'KeyF',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
] as const;

export function socketUrl(host: string, port: number, token: string) {
  return `ws://${host}:${port}/ws?token=${encodeURIComponent(token)}`;
}

export function hostStateUrl(host: string, port: number) {
  return `http://${host}:${port}/api/host-state`;
}

export function serializeMessage(message: TapPadMessage) {
  return JSON.stringify(message);
}

export function releaseMessages(keys: Iterable<string>): TapPadMessage[] {
  return Array.from(keys, (code) => ({ type: 'key' as const, code, down: false }));
}
