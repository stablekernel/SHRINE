// T1 "Pulse" phases (spec 3 phases 5 and 6, plan T1 tasks 1 to 5). After the
// history scan: draw the seeded sample, build evidence packs in memory, size
// them for Gate B. After a Gate B yes for T1: write the work order, arm the
// judge command, run one judge process at a time, and stop early on the abort
// rules. Session text is read only after Gate A consent; nothing is written
// outside the run folder.
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readJson, readText, stat } from '../io/fsread.mjs';
import { InspectError, EXIT } from './errors.mjs';
import { armJudge, disarmJudge, pidAlive, runJudge } from '../io/proc.mjs';
import { drawSample } from '../sample/sample.mjs';
import { buildBundle, bundleTokens, JUDGE_MARKER, newNonce } from '../judge/bundle.mjs';
import { CLASSIFIER_SCHEMA, JUDGED_ENTRY_IDS } from '../judge/validate.mjs';
import { createWorkOrder, estimateOrder, runWorkOrder } from '../judge/workorder.mjs';
import { episodeTranscripts } from '../adapters/claude-code/transcript.mjs';
import { DISCLOSURE, judgeAvailable, judgeInvocation, parseJudgeOutput } from '../adapters/claude-code/judge.mjs';

export const PROMPT_TEMPLATE = readText(fileURLToPath(new URL('../judge/classifier.prompt.md', import.meta.url)));

// Running-judge marker: the pid of the process judging this run.
const RUNNING = 'judging.pid';
const alive = pidAlive;
// The live pid judging this run, or null (no marker, or a stale one).
export function judgingPid(folder) {
  const p = folder.path(RUNNING);
  if (!exists(p)) return null;
  const pid = Number.parseInt(readText(p), 10);
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}
export const judgeBusy = (folder, pid) =>
  new InspectError('E_JUDGE_BUSY', `run ${basename(folder.dir)} is already being judged by process ${pid}; nothing was judged now`, { hint: 'wait for it to finish, then run approve again', exit: EXIT.GATE_WAITING });

// The adapter's judge, or the in-process test seam (io.judge). The bin passes no
// io.judge, so a real run always uses the adapter.
export function judgeAdapter(io, version) {
  if (io.judge) return io.judge;
  const available = judgeAvailable({ env: io.env, version });
  return { available, invocation: available.ok ? judgeInvocation({ bin: available.bin, schema: CLASSIFIER_SCHEMA, env: io.env }) : null, parse: parseJudgeOutput, disclosure: DISCLOSURE };
}

// Current always-loaded instruction files, for a session with no loaded-config
// snapshot: marked may_have_changed when changed after the episode started.
function fallbackConfig(setup, repo, start) {
  const files = setup.always_loaded.by_project.find((b) => b.project === repo)?.files ?? setup.always_loaded.user_files;
  return files.map((f) => {
    const s = stat(f.path);
    let content = '';
    try {
      content = readText(f.path);
    } catch {}
    return { path: f.path, content, may_have_changed: !s || s.mtimeMs > Date.parse(start) };
  });
}

// Sample, bundles, and the Gate B estimate. sampleFile: an existing sample.json
// (a resumed run reuses it) or null.
export async function prepareT1({ seed, history, setup, known, excludedIds, t, adapter, sampleFile = null }) {
  const J = t.judged;
  const sample = sampleFile ?? drawSample({ episodes: history.episodes, seed, size: J.episodes, perProject: J.per_project, weight: J.corrective_weight, sessionMin: J.corrective_session_min, thinTotal: J.thin_total_episodes, excludeSessionIds: excludedIds });
  const byId = new Map(history.episodes.map((e) => [e.id, e]));
  const picked = sample.episode_ids.map((id) => byId.get(id)).filter(Boolean);
  const metas = new Map(history.inventory.sessions.map((s) => [s.id, s]));
  const transcripts = await episodeTranscripts(metas, picked);
  const bundles = [];
  const skipped = [];
  for (const ep of picked) {
    const tr = transcripts.get(ep.id);
    const root = tr?.events.find((e) => e.kind === 'human');
    // A judge prompt saved as a session is never judged again.
    if (!tr || !root || String(root.text).startsWith(JUDGE_MARKER)) {
      skipped.push(ep.id);
      continue;
    }
    const repo = history.roots.get(ep.session_id);
    bundles.push(buildBundle({ episode: ep, transcript: tr, fallbackConfig: tr.snapshot ? [] : fallbackConfig(setup, repo, ep.start), known, nonce: newNonce(), caps: J.caps }));
  }
  const promptTokens = Math.ceil(Buffer.byteLength(PROMPT_TEMPLATE, 'utf8') / J.caps.bytes_per_token);
  const estimate = estimateOrder(bundles.map((b) => bundleTokens(b, J.caps) + promptTokens), J.estimate);
  const starts = picked.map((e) => e.start).sort();
  const gate = {
    available: adapter.available,
    episodes: bundles.length,
    projects: [...new Set(picked.map((e) => e.stratum?.project).filter(Boolean))].sort(),
    from: starts[0] ?? null,
    to: starts.at(-1) ?? null,
    tokens_low: estimate.tokens_low,
    tokens_high: estimate.tokens_high,
    minutes: estimate.minutes,
    eligible: sample.eligible,
    version: adapter.available?.version ?? null,
    thin: sample.thin,
    disclosure: adapter.disclosure ?? [],
  };
  return { sample, bundles, estimate, gate, skipped };
}

// Runs the judge over the work order. Returns {lines, abort, tokens, ms}.
export async function judgePhase({ folder, order, adapter, t, io }) {
  const J = t.judged;
  const inv = adapter.invocation;
  // One judging runner per run: the marker is claimed by exclusive create. Only
  // when that fails is the marker read: a live pid refuses; a dead one is removed
  // and claimed once more. A live runner's marker is never removed.
  if (!folder.claim(RUNNING, `${process.pid}\n`)) {
    const busy = judgingPid(folder);
    if (busy) throw judgeBusy(folder, busy);
    folder.remove(RUNNING);
    if (!folder.claim(RUNNING, `${process.pid}\n`)) throw judgeBusy(folder, judgingPid(folder) ?? 'unknown');
  }
  // Read after the claim, so a runner that follows another sees all its answers.
  const previous = readJudgments(folder);
  try {
    // Throws E_SPAWN_DENIED unless facts.json holds a Gate B yes for T1.
    armJudge(folder.path('facts.json'), inv);
    const cwd = folder.workDir('judge-cwd');
    const r = await runWorkOrder({
      order,
      previous,
      template: PROMPT_TEMPLATE,
      invoke: (input, o = {}) => runJudge({ cmd: inv.cmd, args: inv.args, env: inv.env, cwd, input, timeoutMs: Math.min(J.per_call_timeout_ms, o.timeoutMs ?? Infinity), maxStdout: J.max_stdout_bytes }),
      parse: adapter.parse,
      append: (line) => folder.append('judgments.jsonl', JSON.stringify(line)),
      limits: { tokensUpper: order.estimate.tokens_high, timeBoxMs: order.estimate.minutes * 60000, timeBoxFactor: J.abort.time_box_factor, errorRate: J.abort.error_rate, entryIds: JUDGED_ENTRY_IDS, catalogueIds: new Set(JUDGED_ENTRY_IDS) },
      onProgress: (k, n, tokens) => {
        if (!io.json) io.stderr.write(`Judged ${k} of ${n} episodes, ${tokens.toLocaleString('en-US')} tokens so far\n`);
      },
    });
    return { ...r, lines: [...previous, ...r.lines] };
  } finally {
    disarmJudge();
    folder.remove(RUNNING);
  }
}

// Lines of judgments.jsonl; none yet is an empty list.
export function readJudgments(folder) {
  return exists(folder.path('judgments.jsonl')) ? readText(folder.path('judgments.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

export function readOrder(folder) {
  return exists(folder.path('workorder.json')) ? readJson(folder.path('workorder.json')) : null;
}

export { createWorkOrder };
