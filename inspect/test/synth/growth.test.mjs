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

test('growth keeps the 4x input within the size cap when the 1x input first gets slow near it', () => {
  let largest = 0;
  const spin = (ms) => {
    const t = process.cpuUsage();
    for (;;) {
      const d = process.cpuUsage(t);
      if ((d.user + d.system) / 1000 >= ms) return;
    }
  };
  // Slow only for inputs past half the cap, so the 1x size stops just under it.
  growth((n) => {
    largest = Math.max(largest, n);
    return repeatTo('x')(n);
  }, (s) => (s.length > MAX_N / 2 ? spin(3) : 0), { minMs: 2, tries: 1 });
  assert.ok(largest <= MAX_N, `built ${largest} chars`);
});
