export type TapPadMessage =
  | { type: 'clientInfo'; name: string }
  | { type: 'hostState' }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wheel'; dy: number }
  | { type: 'click'; button: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'pointerButton'; button: PointerButton; down: boolean }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'text'; value: string; submit?: boolean }
  | { type: 'paste'; value: string }
  | { type: 'cmd'; action: string }
  | { type: 'authorize'; password: string };

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export type CapabilityState = 'supported' | 'downgraded' | 'deferred' | 'hidden' | 'unavailable';

export type ActionCapability = {
  state: CapabilityState;
  note?: string;
};

export type ActionCapabilities = Record<string, ActionCapability>;

export const HOST_CONTRACT_VERSION = 1;

export type HostContract = {
  version?: number;
  protocolVersion?: number;
  inputCapabilities?: InputCapabilities;
  actionCapabilities?: ActionCapabilities;
};

export type WorkspaceAction = {
  label: string;
  action: string;
};

export type HostState = {
  contract?: HostContract;
  actions?: ActionCapabilities;
  protocol?: {
    version?: number;
    inputCapabilities?: InputCapabilities;
  };
  authorization?: AuthorizationState;
};

export type AuthorizationState = {
  supported?: boolean;
  requestActive?: boolean;
};

export type PointerButton = 'left' | 'right' | 'middle';

export type InputCapability = {
  state?: string;
  note?: string;
};

export type InputCapabilities = {
  pointerButton?: InputCapability;
  textSubmit?: InputCapability;
};

export type ServerMessage = {
  connectionManagement?: boolean;
  type?: string;
  protocolVersion?: number;
  inputCapabilities?: InputCapabilities;
  code?: string;
  message?: string;
  action?: string;
  status?: string;
  contract?: HostContract;
  hostProof?: string;
  state?: HostState;
};

export const POINTER_BUTTONS = ['left', 'right', 'middle'] as const;

const WORKSPACE_ACTIONS: WorkspaceAction[] = [
  { label: '1', action: 'workspace.1' },
  { label: '2', action: 'workspace.2' },
  { label: '3', action: 'workspace.3' },
  { label: '4', action: 'workspace.4' },
  { label: '5', action: 'workspace.5' },
];

const MOVE_WINDOW_ACTIONS: WorkspaceAction[] = [
  { label: '1', action: 'workspace.move_window.1' },
  { label: '2', action: 'workspace.move_window.2' },
  { label: '3', action: 'workspace.move_window.3' },
  { label: '4', action: 'workspace.move_window.4' },
  { label: '5', action: 'workspace.move_window.5' },
];

export const RELEASABLE_KEYS = [
  'Escape', 'Tab', 'Enter', 'Backspace', 'PrintScreen',
  'MetaLeft', 'ControlLeft', 'ShiftLeft', 'AltLeft', 'Space',
  'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight',
  'KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyB', 'KeyS', 'KeyT', 'KeyW', 'KeyF',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
] as const;

// The pairing token is never in the URL: the native client sends a certificate-bound proof in
// the Authorization header (see host-binding.ts).
export function socketUrl(host: string, port: number) {
  return `wss://${host}:${port}/ws`;
}

export function serializeMessage(message: TapPadMessage) {
  return JSON.stringify(message);
}

export function releaseMessages(keys: Iterable<string>): TapPadMessage[] {
  return Array.from(keys, (code) => ({ type: 'key' as const, code, down: false }));
}

export function releaseInputMessages(
  buttons: Iterable<PointerButton>,
  keys: Iterable<string>,
): TapPadMessage[] {
  return [
    ...Array.from(buttons, (button) => ({ type: 'pointerButton' as const, button, down: false })),
    ...releaseMessages(keys),
  ];
}

export function supportsPointerButton(message: ServerMessage) {
  return supportsInputCapability(message, 'pointerButton');
}

export function supportsTextSubmit(message: ServerMessage) {
  return supportsInputCapability(message, 'textSubmit');
}

function supportsInputCapability(message: ServerMessage, capability: keyof InputCapabilities) {
  const contract = understoodContract(message.contract);
  if (contract) {
    return (
      (contract.protocolVersion ?? 0) >= 2 &&
      contract.inputCapabilities?.[capability]?.state === 'supported'
    );
  }
  return (
    (message.protocolVersion ?? 0) >= 2 &&
    message.inputCapabilities?.[capability]?.state === 'supported'
  );
}

export function hostStateActionCapabilities(state: HostState) {
  return understoodContract(state.contract)?.actionCapabilities ?? state.actions ?? {};
}

export function readyActionCapabilities(message: ServerMessage) {
  return understoodContract(message.contract)?.actionCapabilities ?? null;
}

function understoodContract(contract: HostContract | undefined) {
  return contract?.version === HOST_CONTRACT_VERSION ? contract : undefined;
}

export function supportedWorkspaceActions(capabilities: ActionCapabilities | null) {
  if (!capabilities) return [];
  return WORKSPACE_ACTIONS.filter(({ action }) => capabilities[action]?.state === 'supported');
}

// Older Hosts do not advertise these, so the move toggle stays hidden for them.
export function supportedMoveWindowActions(capabilities: ActionCapabilities | null) {
  if (!capabilities) return [];
  return MOVE_WINDOW_ACTIONS.filter(({ action }) => capabilities[action]?.state === 'supported');
}
