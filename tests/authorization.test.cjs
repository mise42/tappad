const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSession } = require('../mobile/authorization.js');

test('authorization requires a live request and does not retain rejected input', () => {
  const session = createSession();
  const messages = [];
  const send = (message) => { messages.push(message); return true; };
  assert.equal(session.submit('test-password', 100, send), false);
  session.update(true);
  for (const value of ['', '密码', 'password\n', 'a'.repeat(1025)]) {
    assert.equal(session.submit(value, 100, send), false);
  }
  assert.equal(session.submit('test-password', 100, () => false), false);
  assert.equal(session.hasPassword(), false);
  assert.deepEqual(messages, []);
});

test('submission has no automatic retry, supports replacement, clears on disconnect', () => {
  const session = createSession();
  const messages = [];
  const send = (message) => { messages.push(message); return true; };
  session.update(true);
  assert.equal(session.submit('first', 100, send), true);
  assert.equal(session.submit(undefined, 200, send), false);
  session.result('submitted', 200);
  assert.equal(session.canReplace(2199), false);
  assert.equal(session.submit(undefined, 2199, send), false);
  assert.equal(session.canReplace(2200), true);
  assert.equal(messages.length, 1);
  assert.equal(session.submit('replacement', 2200, send), true);
  session.result('submitted', 2200);
  session.update(false);
  assert.equal(session.canReplace(5000), false);
  session.reset();
  session.update(true);
  assert.equal(session.submit(undefined, 5000, send), false);
  assert.deepEqual(messages.map(m => m.password), ['first', 'replacement']);
});

test('forget removes the page password and timeout permits only explicit retry', () => {
  const session = createSession();
  session.update(true);
  session.submit('first', 100, () => true);
  session.result('timeout', 5100);
  assert.equal(session.canSubmit(5100), true);
  session.forget();
  assert.equal(session.submit(undefined, 5100, () => true), false);
});
