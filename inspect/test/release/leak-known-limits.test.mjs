// Pins the leak-check gaps listed under "Known limits" in README.md. They are
// recorded, not fixed: a change here must be deliberate and update the README too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaks } from '../../src/verify/leak.mjs';

const page = (s) => `<p>${s}</p>`;

test('known limit: the OS user is found as a whole word only', () => {
  assert.deepEqual(leaks(page('on jdoe now'), { user: 'jdoe' }), ['user name']);
  assert.deepEqual(leaks(page('on jdoe-mbp and jdoe_mbp now'), { user: 'jdoe' }), []);
});

test('known limit: with no home path given, some absolute paths are not found', () => {
  assert.deepEqual(leaks(page('at /Users/jdoe/x end'), {}), ['absolute path: /Users/jdoe/']);
  for (const p of ['/Users/jdoe end', '/root/x', 'C:\\Users\\jdoe\\x', '/Volumes/Work/x']) assert.deepEqual(leaks(page(`at ${p}`), {}), [], p);
});

test('known limit: a percent-encoded secret in a link is not found', () => {
  assert.deepEqual(leaks('<a href="https://x.test/?k=sk%2Dabc123">l</a>', { secrets: ['sk-abc123'] }), []);
});
