import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS, isDoneClaim, isTestCommand, isCorrectionCue, countRetries, episodeFlags, runUsageProbes, rateDifference } from '../../src/probes/usage.mjs';
import { THRESHOLDS } from '../../src/probes/config.mjs';

for (const [name, fn, list] of [
  ['done-claim', isDoneClaim, PATTERNS.done],
  ['test-command', isTestCommand, PATTERNS.test],
  ['correction-cue', isCorrectionCue, PATTERNS.correction],
]) {
  test(`${name}: every positive fixture matches, no negative does`, () => {
    for (const p of list.positive) assert.ok(fn(p), `positive: ${p}`);
    for (const n of list.negative) assert.ok(!fn(n), `negative: ${n}`);
  });
}

test('retries need the same input within 5 calls and no human turn between', () => {
  const c = (key, h = 0) => ({ key, human_turns_before: h });
  assert.equal(countRetries([c('a'), c('b'), c('a')]), 1);
  assert.equal(countRetries([c('a'), c('b'), c('c'), c('d'), c('e'), c('f'), c('a')]), 0, 'outside the window');
  assert.equal(countRetries([c('a', 1), c('a', 2)]), 0, 'a human turn sits between');
});

const at = (min) => new Date(Date.parse('2026-11-01T10:00:00Z') + min * 60000).toISOString();
const ep = (id, { claim = true, test = false, rework = false, humans = [], tokens = 1000 } = {}) => ({
  id,
  tokens,
  rework,
  last_text: claim ? 'All done.' : 'Here is the plan.',
  last_text_t: at(10),
  calls: test ? [{ t: at(5), name: 'Bash', command: 'npm test', key: 'k', human_turns_before: 1 }] : [{ t: at(5), name: 'Read', command: null, key: 'r', human_turns_before: 1 }],
  humans: [{ index: 0, text: 'build it', after_interrupt: false }, ...humans],
});

test('episode flags: done without test only when no test ran before the claim', () => {
  assert.deepEqual(
    (({ done_claim, tested, done_without_test }) => ({ done_claim, tested, done_without_test }))(episodeFlags(ep('a'))),
    { done_claim: true, tested: false, done_without_test: true },
  );
  assert.equal(episodeFlags(ep('b', { test: true })).done_without_test, false);
  const late = ep('c', { test: true });
  late.calls[0].t = at(20);
  assert.equal(episodeFlags(late).done_without_test, true, 'a test after the claim does not count');
});

test('correction candidates: later human turns with a cue, or right after an interrupt', () => {
  const e = ep('a', { humans: [{ index: 1, text: 'No, use pnpm not npm.', after_interrupt: false }, { index: 2, text: 'ok continue', after_interrupt: true }, { index: 3, text: 'thanks', after_interrupt: false }] });
  assert.equal(episodeFlags(e).corrections, 2);
  const first = ep('b', { humans: [] });
  first.humans[0].text = "Don't touch the db";
  assert.equal(episodeFlags(first).corrections, 0, 'the first human turn is the request, never a correction');
});

test('counts and kinds: done_without_test and retry_loops ship as appendix counts', () => {
  const sessions = [
    { turns: 3, interrupts: 1, compactions: 0, tokens: { in: 600, out: 400, cache_read: 50 }, subagent_share: 0.5 },
    { turns: 2, interrupts: 0, compactions: 1, tokens: { in: 1000, out: 0, cache_read: 0 }, subagent_share: 0 },
  ];
  const episodes = [ep('a', { rework: true }), ep('b'), ep('c', { test: true }), ep('d', { claim: false, rework: true })];
  const r = runUsageProbes({ sessions, episodes });
  assert.equal(r.counts.sessions, 2);
  assert.equal(r.counts.human_turns, 5);
  assert.equal(r.counts.interrupts, 1);
  assert.equal(r.counts.compactions, 1);
  assert.equal(r.counts.subagent_share, 0.25);
  assert.equal(r.counts.done_claims, 3);
  assert.equal(r.counts.done_without_test, 2);
  const dwt = r.kinds.find((k) => k.kind === 'done_without_test');
  assert.equal(dwt.ship, 'appendix', 'E5: 33% clean-room precision');
  assert.equal(dwt.hit, true);
  assert.deepEqual(dwt.control.flagged, { hits: 1, n: 2, rate: 0.5 });
  assert.deepEqual(dwt.control.rest, { hits: 1, n: 2, rate: 0.5 });
  assert.equal(dwt.control.diff_points, 0);
  assert.equal(r.kinds.find((k) => k.kind === 'retry_loops').ship, 'appendix');
  assert.equal(THRESHOLDS.usage.retry_loops.ship, 'appendix');
});

test('rate difference keeps N for both groups', () => {
  assert.deepEqual(rateDifference({ hits: 3, n: 10 }, { hits: 1, n: 20 }), { flagged: { hits: 3, n: 10, rate: 0.3 }, rest: { hits: 1, n: 20, rate: 0.05 }, diff_points: 25 });
  assert.equal(rateDifference({ hits: 0, n: 0 }, { hits: 0, n: 0 }).diff_points, 0);
});
