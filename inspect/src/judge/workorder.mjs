// Work order seam (plan T1 task 4). The CLI writes the order to the run folder
// before any judge runs; a dispatcher consumes it. The only dispatcher built is
// judge_runner: CLI-spawned processes, one at a time. A later dispatcher reads
// the same order. Pure helpers plus the runner loop; spawning goes through the
// injected `invoke`, which the CLI binds to src/io/proc.mjs.
import { judgePrompt } from './bundle.mjs';
import { validateJudgment } from './validate.mjs';

export const JUDGE = 'episode_classifier';
export const JUDGE_VERSION = 1;

// estimate: {tokens_low, tokens_high, minutes}. caps: per-call limits.
export function createWorkOrder({ runId, seed, bundles, estimate, caps }) {
  return {
    schema_version: 1,
    run_id: runId,
    seed,
    judge: JUDGE,
    judge_version: JUDGE_VERSION,
    dispatcher: 'judge_runner',
    caps,
    estimate,
    items: bundles.map((b) => ({ episode_id: b.episode_id, nonce: b.nonce, bundle: b })),
  };
}

// Token range and minutes for Gate B: bundle bytes / 4 plus a fixed per-call
// overhead and output allowance, a retry reserve, then a margin for the top.
export function estimateOrder(bundleTokenCounts, e) {
  const calls = bundleTokenCounts.length;
  const base = bundleTokenCounts.reduce((n, t) => n + t + e.overhead_tokens_per_call + e.output_tokens_per_call, 0);
  const low = Math.round(base);
  const high = Math.round(base * (1 + e.retry_reserve) * (1 + e.margin));
  return { calls, tokens_low: low, tokens_high: high, minutes: Math.max(1, Math.ceil((calls * e.seconds_per_call) / 60)) };
}

// Episode ids that already hold a valid judgment (a resumed run skips them).
export const judgedIds = (lines) => new Set(lines.filter((l) => l.valid).map((l) => l.episode_id));

// Runs every item not yet judged, one process at a time. Each result is one line
// appended to judgments.jsonl. Invalid output gets one retry with the validator's
// error; a second failure or a refusal is a line with valid false. Stops early
// (abort) past the approved token upper bound, past the time box plus 50%, or
// when invalid lines pass 10% of the planned calls; a usage or rate limit stops
// it apart, never counted as a judge error.
// The time box is also a hard deadline inside a call: each call gets at most the
// time left (its own cap still applies), and no retry starts past it.
// invoke(input, {timeoutMs}) -> {status, stdout, timedOut, truncated, ms}; parse(stdout) -> adapter envelope.
export async function runWorkOrder({ order, previous = [], invoke, parse, template, append, limits, clock = Date.now, onProgress = () => {} }) {
  const done = judgedIds(previous);
  const todo = order.items.filter((i) => !done.has(i.episode_id));
  let tokens = previous.reduce((n, l) => n + (l.tokens?.total ?? 0), 0);
  let invalid = previous.filter((l) => !l.valid && !l.limited).length;
  const started = clock();
  const deadline = started + limits.timeBoxMs * limits.timeBoxFactor;
  const lines = [];
  let abort = null;
  let calls = 0;
  // A resumed run already at the bound spawns nothing.
  if (todo.length && tokens >= limits.tokensUpper) {
    return { lines, tokens, invalid, abort: { reason: 'tokens', at: todo[0].episode_id }, calls, ms: 0 };
  }
  for (const [k, item] of todo.entries()) {
    let retryError = null;
    let line = null;
    const used = { in: 0, out: 0, cache_read: 0, cache_write: 0, total: 0 };
    let latency = 0;
    let model = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const input = judgePrompt(item.bundle, { template, entryIds: limits.entryIds ?? [], retryError });
      const r = await invoke(input, { timeoutMs: Math.max(1000, deadline - clock()) });
      latency += r.ms ?? 0;
      const env = parse(r.stdout);
      calls++;
      for (const key of ['in', 'out', 'cache_read', 'cache_write']) used[key] += env.tokens[key];
      // A call cut short (timeout, output cap, crash) reports no usage: charge at
      // least its input size, so the token bound and the total are never low.
      if (!env.tokens.in && !env.tokens.out && !env.tokens.cache_read && !env.tokens.cache_write) {
        used.in += Math.ceil(Buffer.byteLength(input, 'utf8') / 4);
        used.floor = true;
      }
      used.total = used.in + used.out + used.cache_read + used.cache_write;
      model = env.model_id ?? model;
      if (env.limited) {
        abort = { reason: 'limit', at: item.episode_id };
        // A line that only carries the tokens the call used; the episode stays unjudged.
        line = { valid: false, limited: true, output: null, attempts: attempt, refusal: false, errors: ['$: usage limit'] };
        break;
      }
      const v = env.output ? validateJudgment(env.output, item.bundle, { catalogueIds: limits.catalogueIds }) : { ok: false, errors: [r.timedOut ? '$: timed out' : r.truncated ? '$: output too long' : `$: ${env.error ?? 'no output'}`], output: null };
      if (v.ok) {
        line = { valid: true, output: v.output, attempts: attempt, refusal: false, errors: [] };
        break;
      }
      if (env.refusal || attempt === 2 || clock() >= deadline) {
        line = { valid: false, output: null, attempts: attempt, refusal: env.refusal, errors: v.errors.slice(0, 10) };
        break;
      }
      retryError = v.errors.slice(0, 5).join('; ');
    }
    tokens += used.total;
    if (line) {
      const full = { judge: JUDGE, judge_version: JUDGE_VERSION, model_id: model, episode_id: item.episode_id, ...line, latency_ms: latency, tokens: used, at: new Date(clock()).toISOString() };
      append(full);
      lines.push(full);
      if (!line.valid && !line.limited) invalid++;
    }
    onProgress(k + 1, todo.length, tokens);
    if (abort) break;
    if (tokens > limits.tokensUpper) abort = { reason: 'tokens', at: item.episode_id };
    else if (clock() >= deadline) abort = { reason: 'time', at: item.episode_id };
    else if (invalid > order.items.length * limits.errorRate) abort = { reason: 'errors', at: item.episode_id };
    if (abort && k + 1 < todo.length) break;
    // Past a limit on the last item: nothing is left to stop; the summary compares totals.
    if (abort) abort = null;
  }
  return { lines, tokens, invalid, abort, calls, ms: clock() - started };
}
