import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_VOICE_START_ACTION,
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

test('start is enabled only for an explicitly OS-global supported capability', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: {
      state: 'supported',
      scope: 'os-global',
      binding: 'Command+F3',
    },
  });

  assert.deepEqual(control?.start, {
    enabled: true,
    detail: 'Configured global hotkey: Command+F3',
    binding: 'Command+F3',
  });
  assert.equal(control?.start.detail.includes('F2'), false);

  assert.equal(codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'supported', scope: 'app' },
  })?.start.enabled, false);
  assert.equal(codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'supported' },
  }), null);
});

test('unavailable start uses stable reason codes for compact feedback', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: {
      state: 'unavailable',
      scope: 'os-global',
      reasonCode: 'codex_not_running',
      note: 'Long Host diagnostic.',
    },
  });

  assert.equal(control?.start.enabled, false);
  assert.equal(control?.start.detail, 'Open Codex on the Host to register its global hotkey.');
});

test('end and microphone are explanatory app-only rows and never controls', () => {
  const control = codexVoiceControl({
    [CODEX_VOICE_START_ACTION]: { state: 'unavailable', scope: 'os-global' },
    'codex.voice.end': {
      state: 'unavailable',
      scope: 'app',
      reasonCode: 'codex_app_scope_only',
      note: 'Configured as F4.',
    },
    'codex.voice.toggle_microphone': {
      state: 'unavailable',
      scope: 'app',
      reasonCode: 'codex_app_scope_only',
      note: 'Configured as F6.',
    },
  });

  assert.deepEqual(control?.appOnly, [
    { action: 'codex.voice.end', label: 'End voice', detail: 'App-only · not sent globally' },
    { action: 'codex.voice.toggle_microphone', label: 'Microphone', detail: 'App-only · not sent globally' },
  ]);
  assert.equal(JSON.stringify(control).includes('F4'), false);
  assert.equal(JSON.stringify(control).includes('F6'), false);
});

test('request and result copy never claim that a voice session started', () => {
  assert.equal(
    codexVoiceSentNotice('omarchy.local'),
    'Sending the configured Codex voice hotkey to omarchy.local…',
  );
  assert.equal(
    codexVoiceResultNotice('sent', 'ignored Host copy'),
    'Configured Codex voice hotkey sent. Voice session status is not confirmed.',
  );
  assert.equal(
    codexVoiceResultNotice('failed', 'Input dispatch failed.'),
    'Input dispatch failed.',
  );
});
