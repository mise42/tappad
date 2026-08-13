import type { ActionCapabilities, ActionCapability } from './protocol';

export const CODEX_VOICE_START_ACTION = 'codex.voice.start';
export const CODEX_VOICE_END_ACTION = 'codex.voice.end';
export const CODEX_VOICE_MICROPHONE_ACTION = 'codex.voice.toggle_microphone';

export type CodexVoiceUnavailableRow = {
  action: string;
  label: string;
  detail: string;
};

export type CodexVoiceControl = {
  start: {
    enabled: boolean;
    detail: string;
    binding?: string;
  };
  appOnly: CodexVoiceUnavailableRow[];
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

function appOnlyRow(
  action: string,
  label: string,
  capability: ActionCapability | undefined,
): CodexVoiceUnavailableRow | null {
  if (
    capability?.scope !== 'app'
    && capability?.reasonCode !== 'codex_app_scope_only'
  ) return null;

  return { action, label, detail: 'App-only · not sent globally' };
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

  const enabled = start?.state === 'supported' && start.scope === 'os-global';
  const detail = enabled
    ? start.binding
      ? `Configured global hotkey: ${start.binding}`
      : 'Sends the configured global Voice Chat hotkey.'
    : start?.reasonCode && START_FAILURE_COPY[start.reasonCode]
      ? START_FAILURE_COPY[start.reasonCode]
      : start?.state === 'supported'
        ? 'The Host did not verify this Voice Chat hotkey as OS-global.'
        : start?.note || 'The Host did not advertise a usable global Voice Chat hotkey.';

  return {
    start: { enabled, detail, binding: enabled ? start.binding : undefined },
    appOnly: [
      appOnlyRow(CODEX_VOICE_END_ACTION, 'End voice', end),
      appOnlyRow(CODEX_VOICE_MICROPHONE_ACTION, 'Microphone', microphone),
    ].filter((row): row is CodexVoiceUnavailableRow => row !== null),
  };
}

export function codexVoiceSentNotice(hostName: string) {
  return `Sending the configured Codex voice hotkey to ${hostName}…`;
}

export function codexVoiceResultNotice(status: string | undefined, message: string | undefined) {
  if (status === 'sent') {
    return 'Configured Codex voice hotkey sent. Voice session status is not confirmed.';
  }
  return message || 'The Host could not send the configured Codex voice hotkey.';
}
