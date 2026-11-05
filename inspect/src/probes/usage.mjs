// T0 usage probes and counts (spec 4, plan T2.8 with the E5 verdicts). Pure
// functions over extracted episodes. Every regex input is a versioned pattern
// list. Kinds whose detectors failed the precision bar ship as appendix counts
// (thresholds.json usage.<kind>.ship), never as headline findings.
import { fileURLToPath } from 'node:url';
import { readJson } from '../io/fsread.mjs';
import { matchesAtCommand } from './command-position.mjs';
import { THRESHOLDS } from './config.mjs';

const load = (rel) => readJson(fileURLToPath(new URL(rel, import.meta.url)));
export const PATTERNS = {
  done: load('./patterns/done-claim.json'),
  test: load('./patterns/test-command.json'),
  retry: load('./patterns/identical-retry.json'),
  correction: load('./patterns/correction-cue.json'),
};
const DONE = PATTERNS.done.patterns.map((p) => new RegExp(p, 'i'));
const NEG = new RegExp(PATTERNS.done.negation, 'i');
const COND = new RegExp(PATTERNS.done.conditional, 'i');
const CUES = PATTERNS.correction.patterns.map((p) => new RegExp(p, 'i'));

// A done claim in the closing text, unless its sentence negates or conditions it.
export function isDoneClaim(text) {
  const scope = (text ?? '').slice(-600);
  for (const re of DONE) {
    const m = re.exec(scope);
    if (!m) continue;
    const sentenceStart = Math.max(scope.lastIndexOf('. ', m.index), scope.lastIndexOf('\n', m.index), scope.lastIndexOf('! ', m.index)) + 1;
    const before = scope.slice(sentenceStart, m.index);
    if (NEG.test(before) || COND.test(before)) continue;
    return true;
  }
  return false;
}

export const isTestCommand = (command) => matchesAtCommand(command, PATTERNS.test.patterns);
export const isCorrectionCue = (text) => CUES.some((re) => re.test(text ?? ''));

// Retries: same key within the previous `window` calls, no human turn between.
export function countRetries(calls, window = PATTERNS.retry.window) {
  let n = 0;
  calls.forEach((c, i) => {
    const prev = calls.slice(Math.max(0, i - window), i).filter((p) => p.human_turns_before === c.human_turns_before);
    if (prev.some((p) => p.key === c.key)) n++;
  });
  return n;
}

export function episodeFlags(ep) {
  const claim = isDoneClaim(ep.last_text);
  const tested = ep.calls.some((c) => c.name === 'Bash' && (!ep.last_text_t || c.t <= ep.last_text_t) && isTestCommand(c.command));
  const corrections = ep.humans.filter((h) => h.index > 0 && (h.after_interrupt || isCorrectionCue(h.text))).length;
  return { done_claim: claim, tested, done_without_test: claim && !tested, corrections, retries: countRetries(ep.calls), tool_calls: ep.calls.length };
}

const pct = (a, b) => (b ? a / b : 0);

// Rate of an outcome in flagged vs other episodes, with N for both groups.
export function rateDifference(flagged, rest) {
  const fr = pct(flagged.hits, flagged.n);
  const rr = pct(rest.hits, rest.n);
  return { flagged: { ...flagged, rate: fr }, rest: { ...rest, rate: rr }, diff_points: Math.round((fr - rr) * 1000) / 10 };
}

// sessions: facts sessions; episodes: extract + link output (with .rework).
export function runUsageProbes({ sessions, episodes, t = THRESHOLDS }) {
  const u = t.usage;
  const flags = new Map(episodes.map((e) => [e.id, episodeFlags(e)]));
  const sum = (f) => [...flags.values()].reduce((n, x) => n + f(x), 0);
  const attrib = sessions.reduce((n, s) => n + s.tokens.in + s.tokens.out, 0);
  const subTok = sessions.reduce((n, s) => n + s.subagent_share * (s.tokens.in + s.tokens.out), 0);
  const toolCalls = sum((x) => x.tool_calls);
  const retries = sum((x) => x.retries);
  const counts = {
    sessions: sessions.length,
    episodes: episodes.length,
    human_turns: sessions.reduce((n, s) => n + s.turns, 0),
    interrupts: sessions.reduce((n, s) => n + s.interrupts, 0),
    compactions: sessions.reduce((n, s) => n + s.compactions, 0),
    tool_calls: toolCalls,
    retries,
    retries_per_100: Math.round(pct(retries, toolCalls) * 1000) / 10,
    subagent_share: attrib ? Math.round((subTok / attrib) * 1000) / 1000 : 0,
    correction_candidates: sum((x) => x.corrections),
    done_claims: sum((x) => (x.done_claim ? 1 : 0)),
    done_without_test: sum((x) => (x.done_without_test ? 1 : 0)),
    attributable_tokens: attrib,
  };

  const flagged = episodes.filter((e) => flags.get(e.id).done_without_test);
  const rest = episodes.filter((e) => !flags.get(e.id).done_without_test);
  const rate = pct(flagged.length, counts.done_claims);
  const dwt = {
    kind: 'done_without_test',
    lens: 'usage',
    ship: u.done_without_test.ship,
    hit: counts.done_claims > 0 && rate > u.done_without_test.rate,
    metric: { flagged: flagged.length, claims: counts.done_claims, rate, threshold: u.done_without_test.rate },
    control: rateDifference({ hits: flagged.filter((e) => e.rework).length, n: flagged.length }, { hits: rest.filter((e) => e.rework).length, n: rest.length }),
    tokens: flagged.reduce((n, e) => n + e.tokens, 0),
    episode_ids: flagged.map((e) => e.id),
  };
  const retryLoops = {
    kind: 'retry_loops',
    lens: 'usage',
    ship: u.retry_loops.ship,
    hit: counts.retries_per_100 > u.retry_loops.per_100,
    metric: { per_100: counts.retries_per_100, threshold: u.retry_loops.per_100, retries, tool_calls: toolCalls },
    control: null,
    tokens: 0,
    episode_ids: [],
  };
  return { counts, kinds: [dwt, retryLoops], flags };
}
