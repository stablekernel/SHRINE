import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawSample } from '../../src/sample/sample.mjs';
import { mulberry32, newSeed } from '../../src/sample/prng.mjs';

const ep = (i, { corrections = 1, session = `s${i}`, project = 'p1', recency = 'newest' } = {}) => ({
  id: `e-${String(i).padStart(3, '0')}`,
  session_id: session,
  start: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(),
  stratum: { recency, project },
  flags: { corrections },
});
const RECENCY = ['newest', 'middle', 'oldest'];
const pool = (n, opts = {}) => Array.from({ length: n }, (_, i) => ep(i, { recency: RECENCY[i % 3], project: `p${i % 5}`, ...opts }));

test('prng: same seed gives the same stream; a new seed is a positive 31-bit integer', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const s = newSeed();
  assert.ok(Number.isInteger(s) && s > 0 && s < 2 ** 31);
});

test('same seed gives a byte-identical sample.json; a different seed differs', () => {
  const eps = pool(60);
  const a = JSON.stringify(drawSample({ episodes: eps, seed: 11 }));
  const b = JSON.stringify(drawSample({ episodes: [...eps].reverse(), seed: 11 }));
  assert.equal(a, b, 'input order does not matter');
  const c = JSON.stringify(drawSample({ episodes: eps, seed: 12 }));
  assert.notEqual(a, c);
});

test('pool keeps episodes with a correction candidate and drops excluded sessions', () => {
  const eps = [...pool(30), ...Array.from({ length: 30 }, (_, i) => ep(100 + i, { corrections: 0 }))];
  const s = drawSample({ episodes: eps, seed: 3, excludeSessionIds: ['s1', 's2'] });
  assert.equal(s.eligible, 28);
  assert.equal(s.total_episodes, 58);
  assert.ok(!s.episode_ids.includes('e-001') && !s.episode_ids.includes('e-002'));
  assert.ok(s.episode_ids.every((id) => Number(id.slice(2)) < 100), 'no zero-correction episode');
});

test('strata: an equal share per recency third, and at most 4 per project while others can fill', () => {
  const s = drawSample({ episodes: pool(90), seed: 5 });
  assert.equal(s.episode_ids.length, 12);
  assert.deepEqual(s.strata, { middle: 4, newest: 4, oldest: 4 });
  assert.equal(s.cap_relaxed, false);
  const byProject = new Map();
  for (const id of s.episode_ids) {
    const p = `p${Number(id.slice(2)) % 5}`;
    byProject.set(p, (byProject.get(p) ?? 0) + 1);
  }
  assert.ok([...byProject.values()].every((n) => n <= 4));
});

test('one project only: the cap is relaxed and the sample says so', () => {
  const s = drawSample({ episodes: pool(30, { project: 'only' }), seed: 5 });
  assert.equal(s.episode_ids.length, 12);
  assert.equal(s.cap_relaxed, true);
});

test('sessions with 2 or more correction candidates are weighted 3x', () => {
  // 50 single-correction sessions and 50 episodes from 2-correction sessions.
  const light = Array.from({ length: 50 }, (_, i) => ep(i, { project: `p${i}` }));
  const heavy = Array.from({ length: 50 }, (_, i) => ep(200 + i, { corrections: 2, project: `q${i}` }));
  let heavyPicks = 0;
  for (let seed = 1; seed <= 40; seed++) heavyPicks += drawSample({ episodes: [...light, ...heavy], seed }).episode_ids.filter((id) => Number(id.slice(2)) >= 200).length;
  assert.ok(heavyPicks / (40 * 12) > 0.6, `heavy share ${heavyPicks / 480}`);
});

test('fewer than 12 eligible: all are taken, labelled thin; under 20 episodes in all is small history', () => {
  const s = drawSample({ episodes: [...pool(7), ...Array.from({ length: 5 }, (_, i) => ep(50 + i, { corrections: 0 }))], seed: 9 });
  assert.equal(s.episode_ids.length, 7);
  assert.equal(s.thin, true);
  assert.equal(s.small_history, true);
  const big = drawSample({ episodes: pool(40), seed: 9 });
  assert.equal(big.thin, false);
  assert.equal(big.small_history, false);
});

test('a seed must be an integer', () => {
  assert.throws(() => drawSample({ episodes: [], seed: null }));
});
