import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../src/judge/bundle.mjs';
import { createWorkOrder, estimateOrder, runWorkOrder } from '../../src/judge/workorder.mjs';
import { JUDGED_ENTRY_IDS } from '../../src/judge/validate.mjs';
import { parseJudgeOutput } from '../../src/adapters/claude-code/judge.mjs';
import { buildIdentifiers } from '../../src/scrub/mask.mjs';
import { THRESHOLDS } from '../../src/probes/config.mjs';

const TEMPLATE = readFileSync(fileURLToPath(new URL('../../src/judge/classifier.prompt.md', import.meta.url)), 'utf8');
const at = (m) => new Date(Date.UTC(2026, 9, 20, 10, m)).toISOString();
const bundles = (n) =>
  Array.from({ length: n }, (_, i) =>
    buildBundle({
      episode: { id: `e-${i}`, root_turn_id: `u${i}`, start: at(0), end: at(30) },
      transcript: { events: [{ t: at(0), kind: 'human', uuid: `u${i}`, text: 'Add an export.' }, { t: at(1), kind: 'human', uuid: `v${i}`, text: 'Actually, use tabs.' }], snapshot: [] },
      known: buildIdentifiers({}),
      nonce: `n${i}`,
    }),
  );
const answer = (prompt) => {
  const nonce = prompt.match(/<data-(\w+)>\n/)[1];
  const id = prompt.match(/"episode_id":"([^"]+)"/)[1];
  return { episode_id: id, nonce, outcome: 'resolved', corrections: [] };
};
const envelope = (o, tokens = 100) => JSON.stringify({ type: 'result', structured_output: o, usage: { input_tokens: tokens, output_tokens: 10 } });
const order = (n) => createWorkOrder({ runId: 'r', seed: 1, bundles: bundles(n), estimate: { tokens_low: 1000, tokens_high: 100000, minutes: 5 }, caps: {} });
const limits = (o = {}) => ({ tokensUpper: 100000, timeBoxMs: 300000, timeBoxFactor: 1.5, errorRate: 0.1, entryIds: JUDGED_ENTRY_IDS, ...o });
const run = async (o, invoke, extra = {}) => {
  const appended = [];
  const r = await runWorkOrder({ order: o, invoke, parse: parseJudgeOutput, template: TEMPLATE, append: (l) => appended.push(l), limits: limits(extra.limits), previous: extra.previous ?? [], clock: extra.clock });
  return { ...r, appended };
};

test('estimate: bundle tokens plus per-call overhead and output, then a retry reserve and margin for the top', () => {
  const e = THRESHOLDS.judged.estimate;
  const r = estimateOrder([1000, 2000], e);
  const base = 3000 + 2 * (e.overhead_tokens_per_call + e.output_tokens_per_call);
  assert.equal(r.tokens_low, base);
  assert.equal(r.tokens_high, Math.round(base * (1 + e.retry_reserve) * (1 + e.margin)));
  assert.equal(r.calls, 2);
  assert.ok(r.minutes >= 1);
});

// Smoke on Claude Code 2.1.318 (12 real calls, packs about 1,340 tokens): overhead
// 2,830 to 3,120 over bytes / 4, output 146 to 634, total 64,677, 41 seconds.
test('estimate: 12 packs at the cap land in the 20K to 60K tokens of T1; the top keeps the reserve and margin', () => {
  const J = THRESHOLDS.judged;
  const prompt = Math.ceil(Buffer.byteLength(TEMPLATE, 'utf8') / J.caps.bytes_per_token);
  const r = estimateOrder(Array(J.episodes).fill(J.caps.bundle_tokens + prompt), J.estimate);
  assert.ok(r.tokens_low >= 20000 && r.tokens_low <= 60000, `low ${r.tokens_low}`);
  // Known limit: the fixed per-call cost alone (prompt, overhead, output) times 12
  // with the reserve and margin passes 60K, so the top cannot fit at any pack size.
  assert.ok(estimateOrder(Array(J.episodes).fill(prompt), J.estimate).tokens_high > 60000);
  assert.ok(r.minutes <= 5, `minutes ${r.minutes}`);
});

test('one call per item; every line records tokens, model, and the validated output only', async () => {
  const calls = [];
  const r = await run(order(3), async (input) => {
    calls.push(input);
    return { stdout: envelope(answer(input)), ms: 5 };
  });
  assert.equal(calls.length, 3);
  assert.equal(r.appended.length, 3);
  assert.ok(r.appended.every((l) => l.valid && l.tokens.total === 110 && l.judge === 'episode_classifier' && l.attempts === 1));
  assert.equal(r.abort, null);
});

test('invalid output: one retry carrying the validator error; a second failure is a line with valid false', async () => {
  const inputs = [];
  const r = await run(order(1), async (input) => {
    inputs.push(input);
    return { stdout: envelope({ nope: true }), ms: 1 };
  });
  assert.equal(inputs.length, 2);
  assert.match(inputs[1], /The validator rejected your previous output: \$: missing episode_id/);
  assert.equal(r.appended[0].valid, false);
  assert.equal(r.appended[0].output, null);
  assert.equal(r.appended[0].attempts, 2);
});

test('a refusal is not retried', async () => {
  let n = 0;
  const r = await run(order(1), async () => {
    n++;
    return { stdout: JSON.stringify({ type: 'result', subtype: 'refusal', stop_reason: 'refusal', result: 'no' }), ms: 1 };
  });
  assert.equal(n, 1);
  assert.equal(r.appended[0].refusal, true);
});

test('abort: tokens past the approved upper bound', async () => {
  const r = await run(order(5), async (input) => ({ stdout: envelope(answer(input), 600), ms: 1 }), { limits: { tokensUpper: 1000 } });
  assert.equal(r.abort.reason, 'tokens');
  assert.equal(r.appended.length, 2);
});

test('abort: invalid answers over 10% of planned calls', async () => {
  const r = await run(order(12), async () => ({ stdout: 'garbage', ms: 1 }));
  assert.equal(r.abort.reason, 'errors');
  assert.equal(r.appended.length, 2);
});

test('abort: time box plus 50%', async () => {
  let now = 0;
  const r = await run(order(4), async (input) => {
    now += 300000;
    return { stdout: envelope(answer(input)), ms: 1 };
  }, { clock: () => now, limits: { timeBoxMs: 300000 } });
  assert.equal(r.abort.reason, 'time');
});

test('a usage limit stops at once and leaves the episode unjudged', async () => {
  const r = await run(order(3), async () => ({ stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Usage limit reached' }), ms: 1 }));
  assert.equal(r.abort.reason, 'limit');
  assert.ok(r.appended.every((l) => !l.valid && l.limited));
});

test('resume judges only the missing ids, so finished calls are never re-billed', async () => {
  const o = order(12);
  const previous = [{ episode_id: 'e-0', valid: true, tokens: { total: 50 } }, { episode_id: 'e-1', valid: false, tokens: { total: 50 } }];
  const seen = [];
  const r = await run(o, async (input) => {
    seen.push(input.match(/"episode_id":"([^"]+)"/)[1]);
    return { stdout: envelope(answer(input)), ms: 1 };
  }, { previous });
  assert.deepEqual(seen, Array.from({ length: 11 }, (_, i) => `e-${i + 1}`), 'e-0 is done; the invalid e-1 is judged again');
  assert.equal(r.tokens, 100 + 11 * 110);
});

test('a usage-limited call leaves a line with its tokens, not counted as invalid', async () => {
  const r = await run(order(3), async () => ({ stdout: JSON.stringify({ type: 'result', is_error: true, result: 'Usage limit reached', usage: { input_tokens: 40, output_tokens: 0 } }), ms: 1 }));
  assert.equal(r.abort.reason, 'limit');
  assert.equal(r.appended.length, 1);
  assert.equal(r.appended[0].limited, true);
  assert.equal(r.appended[0].tokens.total, 40);
  assert.equal(r.invalid, 0);
});

test('resume past the token bound: zero calls, abort tokens', async () => {
  const previous = [{ episode_id: 'e-0', valid: true, tokens: { total: 600 } }, { episode_id: 'e-1', valid: true, tokens: { total: 600 } }];
  let n = 0;
  const r = await run(order(5), async (input) => {
    n++;
    return { stdout: envelope(answer(input)), ms: 1 };
  }, { previous, limits: { tokensUpper: 1000 } });
  assert.equal(n, 0);
  assert.equal(r.calls, 0);
  assert.equal(r.abort.reason, 'tokens');
  assert.equal(r.abort.at, 'e-2');
  assert.equal(r.tokens, 1200);
});
