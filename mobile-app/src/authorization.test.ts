import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORIZATION_RETRY_COOLDOWN_MS,
  authorizationPasswordError,
  authorizationPasswordKey,
  authorizationRecoveryState,
  authorizationResultNotice,
  shouldMaskAuthorizationPassword,
} from './authorization.ts';

test('authorization password storage is scoped to the stable Host id', () => {
  assert.equal(
    authorizationPasswordKey('host/a b'),
    'tappad.authorization-password.v1.host%2Fa%20b',
  );
});

test('authorization passwords are non-empty ASCII only', () => {
  assert.equal(authorizationPasswordError('ascii-password'), null);
  assert.match(authorizationPasswordError('') || '', /请输入/);
  assert.match(authorizationPasswordError('密码') || '', /ASCII/);
});

test('successful submission reports only that input was submitted', () => {
  assert.equal(authorizationResultNotice('submitted', 'Host copy'), '已提交');
  assert.equal(authorizationResultNotice('blocked', 'No request.'), 'No request.');
});

test('saved authorization passwords expose replacement only after the retry cooldown', () => {
  const submittedAt = 1_000;

  assert.equal(authorizationRecoveryState({
    requestActive: true,
    passwordSaved: true,
    submittedAt,
    now: submittedAt + AUTHORIZATION_RETRY_COOLDOWN_MS - 1,
  }), 'cooldown');
  assert.equal(authorizationRecoveryState({
    requestActive: true,
    passwordSaved: true,
    submittedAt,
    now: submittedAt + AUTHORIZATION_RETRY_COOLDOWN_MS,
  }), 'replace');
});

test('authorization recovery is hidden without an active request or saved password', () => {
  assert.equal(authorizationRecoveryState({
    requestActive: false,
    passwordSaved: true,
    submittedAt: 1_000,
    now: 4_000,
  }), 'hidden');
  assert.equal(authorizationRecoveryState({
    requestActive: true,
    passwordSaved: false,
    submittedAt: 1_000,
    now: 4_000,
  }), 'hidden');
});

test('authorization password visibility is masked by default and toggles explicitly', () => {
  assert.equal(shouldMaskAuthorizationPassword(false), true);
  assert.equal(shouldMaskAuthorizationPassword(true), false);
});
