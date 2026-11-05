import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growth, repeatTo, MAX_N } from './growth.mjs';

test('growth reads code that stays fast at the size cap as linear, without building larger inputs', () => {
  let largest = 0;
  const g = growth((n) => {
    largest = Math.max(largest, n);
    return repeatTo('x')(n);
  }, (s) => s.length);
  assert.equal(g, 1);
  assert.ok(largest <= MAX_N, `built ${largest} chars`);
});
