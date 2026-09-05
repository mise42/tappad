import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_VOICE_END_ACTION,
  CODEX_VOICE_MICROPHONE_ACTION,
  CODEX_VOICE_START_ACTION,
  CODEX_VOICE_START_FOREGROUND_ACTION,
  codexVoiceControl,
  codexVoiceResultNotice,
  codexVoiceSentNotice,
} from './codexVoice.ts';

test('old Hosts without Codex capabilities do not render the Codex group', () => {
  assert.equal(codexVoiceControl(null), null);
  assert.equal(codexVoiceControl({ screenshot: { state: 'supported' } }), null);
  assert.equal(codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: {
      state: 'unavailable',
      scope: 'unknown',
      reasonCode: 'codex_platform_not_verified',
    },
  }), null);
});

test('start behavior remains gated on an explicitly OS-global supported capability', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: {
      state: 'supported',
      scope: 'os-global',
      binding: 'Command+F3',
    },
  });

  assert.deepEqual(control?.actions[0], {
    action: CODEX_VOICE_START_ACTION,
    label: 'Start',
    enabled: true,
    detail: 'Configured global hotkey: Command+F3',
    disabledLabel: undefined,
  });
  assert.equal(control?.actions[0]?.detail.includes('F2'), false);

  assert.equal(codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'supported', scope: 'app' },
  })?.actions[0]?.enabled, false);
  assert.equal(codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'supported' },
  }), null);
});

test('Hosts without foreground start keep the existing Start, End, and Mute controls', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'supported', scope: 'os-global' },
    [CODEX_VOICE_END_ACTION]: { state: 'supported', scope: 'app' },
    [CODEX_VOICE_MICROPHONE_ACTION]: { state: 'supported', scope: 'app' },
  });
  assert.deepEqual(control?.actions.map((action) => action.label), ['Start', 'End', 'Mute']);
});

test('foreground start, end, and mute become compact enabled app controls', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'unavailable', scope: 'os-global' },
    [CODEX_VOICE_START_FOREGROUND_ACTION]: {
      state: 'supported',
      scope: 'app',
      binding: 'Ctrl+Shift+V',
    },
    [CODEX_VOICE_END_ACTION]: {
      state: 'supported',
      scope: 'app',
      binding: 'F3',
    },
    [CODEX_VOICE_MICROPHONE_ACTION]: {
      state: 'supported',
      scope: 'app',
      binding: 'F4',
    },
  });

  assert.deepEqual(control?.actions.slice(1), [
    {
      action: CODEX_VOICE_START_FOREGROUND_ACTION,
      label: 'Start here',
      enabled: true,
      detail: 'Start here shortcut available while Codex is foreground.',
      disabledLabel: undefined,
    },
    {
      action: CODEX_VOICE_END_ACTION,
      label: 'End',
      enabled: true,
      detail: 'End shortcut available while Codex is foreground.',
      disabledLabel: undefined,
    },
    {
      action: CODEX_VOICE_MICROPHONE_ACTION,
      label: 'Mute',
      enabled: true,
      detail: 'Mute shortcut available while Codex is foreground.',
      disabledLabel: undefined,
    },
  ]);
  assert.equal(control?.foregroundRequired, false);
  assert.equal(JSON.stringify(control).includes('F3'), false);
  assert.equal(JSON.stringify(control).includes('F4'), false);
  assert.equal(JSON.stringify(control).includes('Ctrl+Shift+V'), false);
});

test('all app controls stay visible but disabled when Codex is not foreground', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'unavailable', scope: 'os-global' },
    [CODEX_VOICE_START_FOREGROUND_ACTION]: {
      state: 'unavailable',
      scope: 'app',
      reasonCode: 'codex_not_foreground',
    },
    [CODEX_VOICE_END_ACTION]: {
      state: 'unavailable',
      scope: 'app',
      reasonCode: 'codex_not_foreground',
      note: 'Long Host diagnostic.',
    },
    [CODEX_VOICE_MICROPHONE_ACTION]: {
      state: 'unavailable',
      scope: 'app',
      reasonCode: 'codex_foreground_identity_mismatch',
    },
  });

  assert.deepEqual(control?.actions.slice(1).map((action) => ({
    action: action.action,
    enabled: action.enabled,
    disabledLabel: action.disabledLabel,
  })), [
    { action: CODEX_VOICE_START_FOREGROUND_ACTION, enabled: false, disabledLabel: 'Focus Codex' },
    { action: CODEX_VOICE_END_ACTION, enabled: false, disabledLabel: 'Focus Codex' },
    { action: CODEX_VOICE_MICROPHONE_ACTION, enabled: false, disabledLabel: 'Focus Codex' },
  ]);
  assert.equal(control?.foregroundRequired, true);
});

test('request and result copy reports only shortcut dispatch or a block', () => {
  assert.equal(
    codexVoiceSentNotice(CODEX_VOICE_START_ACTION, 'omarchy.local'),
    'Sending the configured Codex voice hotkey to omarchy.local…',
  );
  assert.equal(
    codexVoiceResultNotice(CODEX_VOICE_START_ACTION, 'sent', 'ignored Host copy'),
    'Configured Codex voice hotkey sent. Voice session status is not confirmed.',
  );
  assert.equal(
    codexVoiceResultNotice(CODEX_VOICE_START_FOREGROUND_ACTION, 'sent', undefined),
    'Foreground Start shortcut sent. Voice session status is not confirmed.',
  );
  assert.equal(
    codexVoiceResultNotice(CODEX_VOICE_END_ACTION, 'sent', undefined),
    'End shortcut sent. Voice state is not confirmed.',
  );
  assert.equal(
    codexVoiceResultNotice(CODEX_VOICE_MICROPHONE_ACTION, 'sent', undefined),
    'Mute shortcut sent. Microphone state is not confirmed.',
  );
  assert.equal(
    codexVoiceResultNotice(CODEX_VOICE_END_ACTION, 'failed', 'Codex is not foreground.'),
    'Blocked: focus Codex and try again.',
  );
});
