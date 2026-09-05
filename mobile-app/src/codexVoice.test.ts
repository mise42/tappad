import test from 'node:test';
import assert from 'node:assert/strict';
import { codexVoiceControl, codexVoiceResultNotice, isCodexVoiceAction } from './codexVoice.ts';

test('no Codex group without advertised commands', () => {
  assert.equal(codexVoiceControl(null), null);
  assert.equal(codexVoiceControl({ screenshot: {state: 'supported'} }), null);
});
test('one record button sends only contextual Host action', () => {
  const control = codexVoiceControl({
    'codex.voice.record': {state:'supported',scope:'contextual'},
    'codex.voice.start': {state:'supported',scope:'os-global'},
    'codex.voice.start_foreground': {state:'supported',scope:'app'},
    'codex.voice.end': {state:'supported',scope:'app'},
    'codex.voice.toggle_microphone': {state:'supported',scope:'app'},
  });
  assert.deepEqual(control?.actions.map(a=>[a.label,a.action,a.enabled]), [
    ['Record','codex.voice.record',true], ['End','codex.voice.end',true], ['Mute','codex.voice.toggle_microphone',true],
  ]);
});
test('old Host cannot silently fall back to global start', () => {
  const control=codexVoiceControl({'codex.voice.start':{state:'supported',scope:'os-global'}});
  assert.equal(control?.actions.length,1);
  assert.equal(control?.actions[0].enabled,false);
  assert.equal(control?.actions[0].action,'codex.voice.record');
});
test('foreground-only controls retain focus guidance', () => {
  const control=codexVoiceControl({'codex.voice.end':{state:'unavailable',scope:'app',reasonCode:'codex_not_foreground'}});
  assert.equal(control?.foregroundRequired,true);
});
test('record reports dispatch and preserves concrete errors without claiming voice state', () => {
  assert.equal(isCodexVoiceAction('codex.voice.record'),true);
  assert.match(codexVoiceResultNotice('codex.voice.record','sent',''),/not confirmed/);
  assert.equal(codexVoiceResultNotice('codex.voice.record','failed','Binding missing'),'Binding missing');
  assert.match(codexVoiceResultNotice('codex.voice.end','sent',''),/not confirmed/);
  assert.match(codexVoiceResultNotice('codex.voice.toggle_microphone','sent',''),/not confirmed/);
});
