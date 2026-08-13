import type { ActionCapabilities, ActionCapability } from './protocol';

export const CODEX_VOICE_START_ACTION = 'codex.voice.start';
export const CODEX_VOICE_END_ACTION = 'codex.voice.end';
export const CODEX_VOICE_MICROPHONE_ACTION = 'codex.voice.toggle_microphone';

export type CodexVoiceAction = {
  action: string;
  label: string;
  enabled: boolean;
  detail: string;
  disabledLabel?: string;
};

export type CodexVoiceControl = {
  actions: CodexVoiceAction[];
  foregroundRequired: boolean;
};

const START_FAILURE_COPY: Record<string, string> = {
  codex_not_installed: 'Codex desktop was not found on this Host.',
  codex_not_running: 'Open Codex on the Host to register its global hotkey.',
  codex_home_unavailable: 'The Host cannot locate Codex keybindings.',
  codex_bindings_unreadable: 'The Host cannot read Codex keybindings.',
  codex_bindings_invalid: 'Codex keybindings are not valid.',
  codex_global_binding_missing: 'No global Voice Chat hotkey is configured.',
  codex_global_binding_ambiguous: 'More than one global Voice Chat hotkey is configured.',
  codex_global_binding_unsupported: 'The configured Voice Chat hotkey cannot be sent safely.',
  codex_runtime_unreadable: 'The Host cannot verify that Codex is running.',
  codex_platform_not_verified: 'Global Codex voice control is not verified on this Host.',
};

const APP_FAILURE_COPY: Record<string, { detail: string; disabledLabel: string }> = {
  codex_not_foreground: { detail: 'Focus Codex to enable.', disabledLabel: 'Focus Codex' },
  codex_foreground_identity_mismatch: { detail: 'Focus the installed Codex app.', disabledLabel: 'Focus Codex' },
  codex_foreground_unreadable: { detail: 'Foreground status unavailable.', disabledLabel: 'Unavailable' },
  codex_app_binding_missing: { detail: 'Shortcut not configured.', disabledLabel: 'Not set' },
  codex_app_binding_ambiguous: { detail: 'Shortcut binding is ambiguous.', disabledLabel: 'Unavailable' },
  codex_app_binding_unsupported: { detail: 'Shortcut binding is unsupported.', disabledLabel: 'Unavailable' },
  codex_not_installed: { detail: 'Codex was not found.', disabledLabel: 'Unavailable' },
  codex_home_unavailable: { detail: 'Keybindings unavailable.', disabledLabel: 'Unavailable' },
  codex_bindings_unreadable: { detail: 'Keybindings unavailable.', disabledLabel: 'Unavailable' },
  codex_bindings_invalid: { detail: 'Invalid keybindings.', disabledLabel: 'Unavailable' },
};

function startAction(capability: ActionCapability | undefined): CodexVoiceAction {
  const enabled = capability?.state === 'supported' && capability.scope === 'os-global';
  const detail = enabled
    ? capability.binding
      ? `Configured global hotkey: ${capability.binding}`
      : 'Sends the configured global Voice Chat hotkey.'
    : capability?.reasonCode && START_FAILURE_COPY[capability.reasonCode]
      ? START_FAILURE_COPY[capability.reasonCode]
      : capability?.state === 'supported'
        ? 'The Host did not verify this Voice Chat hotkey as OS-global.'
        : capability?.note || 'The Host did not advertise a usable global Voice Chat hotkey.';
  return {
    action: CODEX_VOICE_START_ACTION,
    label: 'Start',
    enabled,
    detail,
    disabledLabel: enabled ? undefined : 'Unavailable',
  };
}

function appAction(
  action: string,
  label: string,
  capability: ActionCapability | undefined,
): CodexVoiceAction | null {
  if (capability?.scope !== 'app') return null;
  const enabled = capability.state === 'supported';
  const failure = capability.reasonCode ? APP_FAILURE_COPY[capability.reasonCode] : undefined;
  return {
    action,
    label,
    enabled,
    detail: enabled
      ? `${label} shortcut available while Codex is foreground.`
      : failure?.detail || capability.note || `${label} is unavailable.`,
    disabledLabel: enabled ? undefined : failure?.disabledLabel || 'Unavailable',
  };
}

export function codexVoiceControl(capabilities: ActionCapabilities | null): CodexVoiceControl | null {
  if (!capabilities) return null;

  const start = capabilities[CODEX_VOICE_START_ACTION];
  const end = capabilities[CODEX_VOICE_END_ACTION];
  const microphone = capabilities[CODEX_VOICE_MICROPHONE_ACTION];
  if (!start && !end && !microphone) return null;
  if (![start, end, microphone].some(
    (capability) => capability?.scope === 'os-global' || capability?.scope === 'app',
  )) return null;

  const appActions = [
    appAction(CODEX_VOICE_END_ACTION, 'End', end),
    appAction(CODEX_VOICE_MICROPHONE_ACTION, 'Mute', microphone),
  ].filter((action): action is CodexVoiceAction => action !== null);
  return {
    actions: [startAction(start), ...appActions],
    foregroundRequired: appActions.some(
      (action) => !action.enabled && action.disabledLabel === 'Focus Codex',
    ),
  };
}

export function isCodexVoiceAction(action: string | undefined): action is string {
  return action === CODEX_VOICE_START_ACTION
    || action === CODEX_VOICE_END_ACTION
    || action === CODEX_VOICE_MICROPHONE_ACTION;
}

export function codexVoiceSentNotice(action: string, hostName: string) {
  switch (action) {
    case CODEX_VOICE_START_ACTION:
      return `Sending the configured Codex voice hotkey to ${hostName}…`;
    case CODEX_VOICE_END_ACTION:
      return `Sending End shortcut to ${hostName}…`;
    case CODEX_VOICE_MICROPHONE_ACTION:
      return `Sending Mute shortcut to ${hostName}…`;
    default:
      return `Sending Codex shortcut to ${hostName}…`;
  }
}

export function codexVoiceResultNotice(
  action: string,
  status: string | undefined,
  message: string | undefined,
) {
  if (status === 'sent') {
    switch (action) {
      case CODEX_VOICE_START_ACTION:
        return 'Configured Codex voice hotkey sent. Voice session status is not confirmed.';
      case CODEX_VOICE_END_ACTION:
        return 'End shortcut sent. Voice state is not confirmed.';
      case CODEX_VOICE_MICROPHONE_ACTION:
        return 'Mute shortcut sent. Microphone state is not confirmed.';
    }
  }
  if (message?.toLowerCase().includes('foreground')) {
    return 'Blocked: focus Codex and try again.';
  }
  if (action === CODEX_VOICE_END_ACTION) return 'End shortcut could not be sent.';
  if (action === CODEX_VOICE_MICROPHONE_ACTION) return 'Mute shortcut could not be sent.';
  return message || 'The Host could not send the configured Codex voice hotkey.';
}
