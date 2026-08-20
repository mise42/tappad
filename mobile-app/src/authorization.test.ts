import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizationPasswordError,
  authorizationPasswordKey,
  authorizationResultNotice,
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
