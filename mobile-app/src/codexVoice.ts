import type { ActionCapabilities, ActionCapability } from './protocol';

export const CODEX_VOICE_RECORD_ACTION = 'codex.voice.record';
export const CODEX_VOICE_START_ACTION = 'codex.voice.start';
export const CODEX_VOICE_START_FOREGROUND_ACTION = 'codex.voice.start_foreground';
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

const APP_FAILURE_COPY: Record<string, { detail: string; disabledLabel: string }> = {
  codex_not_foreground: { detail: 'Focus Codex to enable.', disabledLabel: 'Focus Codex' },
  codex_foreground_identity_mismatch: { detail: 'Focus the installed Codex app.', disabledLabel: 'Focus Codex' },
  codex_foreground_unreadable: { detail: 'Foreground status unavailable.', disabledLabel: 'Unavailable' },
  codex_app_binding_missing: { detail: 'Shortcut not configured.', disabledLabel: 'Not set' },
  codex_app_binding_ambiguous: { detail: 'Shortcut binding is ambiguous.', disabledLabel: 'Unavailable' },
  codex_app_binding_unsupported: { detail: 'Shortcut binding is unsupported.', disabledLabel: 'Unavailable' },
  codex_app_metadata_unreadable: { detail: 'Command metadata unavailable.', disabledLabel: 'Unavailable' },
  codex_app_metadata_ambiguous: { detail: 'Command metadata is ambiguous.', disabledLabel: 'Unavailable' },
  codex_app_command_missing: { detail: 'App command unavailable.', disabledLabel: 'Unavailable' },
  codex_app_command_ambiguous: { detail: 'App command is ambiguous.', disabledLabel: 'Unavailable' },
  codex_app_command_scope_mismatch: { detail: 'App command scope is unsupported.', disabledLabel: 'Unavailable' },
  codex_not_installed: { detail: 'Codex was not found.', disabledLabel: 'Unavailable' },
  codex_home_unavailable: { detail: 'Keybindings unavailable.', disabledLabel: 'Unavailable' },
  codex_bindings_unreadable: { detail: 'Keybindings unavailable.', disabledLabel: 'Unavailable' },
  codex_bindings_invalid: { detail: 'Invalid keybindings.', disabledLabel: 'Unavailable' },
};

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
  if (!capabilities || !Object.keys(capabilities).some((key) => key.startsWith('codex.voice.'))) return null;
  const record = capabilities[CODEX_VOICE_RECORD_ACTION];
  const enabled = record?.state === 'supported' && record.scope === 'contextual';
  const actions: CodexVoiceAction[] = [{
    action: CODEX_VOICE_RECORD_ACTION,
    label: 'Record',
    enabled,
    detail: record?.note || 'Update the Host to enable foreground-aware recording.',
    disabledLabel: enabled ? undefined : 'Unavailable',
  }];
  for (const [action, label] of [[CODEX_VOICE_END_ACTION, 'End'], [CODEX_VOICE_MICROPHONE_ACTION, 'Mute']]) {
    const control = appAction(action, label, capabilities[action]);
    if (control) actions.push(control);
  }
  return {
    actions,
    foregroundRequired: actions.slice(1).some((action) => action.disabledLabel === 'Focus Codex'),
  };
}

export function isCodexVoiceAction(action: string | undefined): action is string {
  return action === CODEX_VOICE_RECORD_ACTION
    || action === CODEX_VOICE_START_ACTION
    || action === CODEX_VOICE_START_FOREGROUND_ACTION
    || action === CODEX_VOICE_END_ACTION
    || action === CODEX_VOICE_MICROPHONE_ACTION;
}

export function codexVoiceSentNotice(action: string, hostName: string) {
  switch (action) {
    case CODEX_VOICE_RECORD_ACTION:
      return `Sending Record to ${hostName}…`;
    case CODEX_VOICE_START_ACTION:
      return `Sending the configured Codex voice hotkey to ${hostName}…`;
    case CODEX_VOICE_START_FOREGROUND_ACTION:
      return `Sending the foreground Start shortcut to ${hostName}…`;
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
      case CODEX_VOICE_RECORD_ACTION:
        return 'Record shortcut sent. Voice session status is not confirmed.';
      case CODEX_VOICE_START_ACTION:
        return 'Configured Codex voice hotkey sent. Voice session status is not confirmed.';
      case CODEX_VOICE_START_FOREGROUND_ACTION:
        return 'Foreground Start shortcut sent. Voice session status is not confirmed.';
      case CODEX_VOICE_END_ACTION:
        return 'End shortcut sent. Voice state is not confirmed.';
      case CODEX_VOICE_MICROPHONE_ACTION:
        return 'Mute shortcut sent. Microphone state is not confirmed.';
    }
  }
  if (message) return message;
  if (action === CODEX_VOICE_RECORD_ACTION) return 'The Host could not dispatch Record.';
  if (message?.toLowerCase().includes('foreground')) {
    return 'Blocked: focus Codex and try again.';
  }
  if (action === CODEX_VOICE_START_FOREGROUND_ACTION) return 'Foreground Start shortcut could not be sent.';
  if (action === CODEX_VOICE_END_ACTION) return 'End shortcut could not be sent.';
  if (action === CODEX_VOICE_MICROPHONE_ACTION) return 'Mute shortcut could not be sent.';
  return message || 'The Host could not send the configured Codex voice hotkey.';
}
