// Background runs (plan T3.1): `start` creates a run and continues it in a
// detached worker, so a long scan or judging survives a closed terminal;
// `status` reports where a run is; `resume` restarts a stopped run at its first
// missing .done marker. Gates are never answered here: a worker has no
// terminal, so it pauses at every gate, and `approve --background` answers in
// the user's terminal and hands the rest back to a worker.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { exists, list, readJson, readText } from '../io/fsread.mjs';
import { pidAlive, spawnWorker } from '../io/proc.mjs';
import { InspectError, EXIT } from './errors.mjs';
import { cutOffCount, judgedIds } from '../judge/workorder.mjs';

const PID = 'worker.pid';
const LOG = 'run.log';
// Phases in run order; the last one done is the run's progress.
const PHASES = ['gate_b', 'sample', 'scan', 'facts', 'judgments', 'verify', 'findings', 'report'];

// The live worker pid for this run folder, or null (none, or it exited).
export function workerPid(folder) {
  const p = folder.path(PID);
  if (!exists(p)) return null;
  const pid = Number.parseInt(readText(p), 10);
  return pidAlive(pid) ? pid : null;
}

const busy = (runId, pid) =>
  new InspectError('E_RUN_BUSY', `run ${runId} is already running in the background (process ${pid})`, { hint: `check it with: shrine-inspect status ${runId}`, exit: EXIT.GATE_WAITING });

export function assertIdle(folder, runId) {
  const pid = workerPid(folder);
  if (pid) throw busy(runId, pid);
}

// Runs fn as this run's one runner: refuses when another live process holds
// worker.pid, records this process when none does (a foreground run or
// approve), and removes the file on exit when it names this process.
export async function asRunner(folder, runId, fn) {
  const other = workerPid(folder);
  if (other && other !== process.pid) throw busy(runId, other);
  if (!other) folder.write(PID, `${process.pid}\n`);
  try {
    return await fn();
  } finally {
    if (workerPid(folder) === process.pid) folder.remove(PID);
  }
}

// A grant is good for this long after `approve --background` writes it.
export const GRANT_TTL_MS = 5 * 60_000;

// Judging that has not finished needs a fresh typed yes before any judge call
// (the same rule as `approve`). A worker gets that yes only as a one-time grant
// written by `approve --background`.
function judgingPending(folder, state) {
  return state.gates?.B?.choice === 'T1' && !folder.isDone('judgments') && !state.gates.C && !state.abort && !['done', 'gate_c', 'scope_changed'].includes(state.phase);
}

// The gate a run waits at with no answer yet (A, B, or C), else null. A Gate C
// pause has unfinished judging, so continuing it would call the judge again.
function openGate(state) {
  const gate = { gate_a: 'A', gate_b: 'B', gate_c: 'C' }[state.phase];
  return gate && !state.gates?.[gate] ? gate : null;
}

// The worker's environment variable that carries a grant: never an argument,
// which any local user can read in the process list.
export const GRANT_ENV = 'SHRINE_INSPECT_GRANT';

// Starts a worker that runs `resume <run> --worker`. grant: a one-time token
// that lets the worker continue judging; written to state.json first.
export function launchWorker(folder, ctx, io, { grant = false } = {}) {
  const state = readJson(folder.path('state.json'));
  assertIdle(folder, state.run_id);
  const args = ['resume', state.run_id, '--worker'];
  const { [GRANT_ENV]: _stale, ...env } = io.env ?? {};
  if (grant) {
    state.grant = { token: randomBytes(16).toString('hex'), at: Date.now() };
    folder.writeJson('state.json', state);
    env[GRANT_ENV] = state.grant.token;
  }
  const fd = folder.openLog(LOG);
  let pid;
  try {
    pid = spawnWorker(args, { env, cwd: ctx.home, logFd: fd });
  } catch (e) {
    // No worker, so no grant left lying in state.json.
    if (grant) {
      delete state.grant;
      folder.writeJson('state.json', state);
    }
    throw e;
  } finally {
    folder.closeLog(fd);
  }
  folder.write(PID, `${pid}\n`);
  return { run_id: state.run_id, pid, run_dir: folder.dir, log: folder.path(LOG) };
}

function printStarted(r, io, verb) {
  if (io.json) io.stdout.write(`${JSON.stringify({ ...r, background: true })}\n`);
  else io.stdout.write(`${verb} run ${r.run_id} in the background (process ${r.pid}).\nLog: ${r.log}\nCheck it with: shrine-inspect status ${r.run_id}\n`);
}

export function startCommand(opts, io, { createRun }) {
  const { folder, ctx } = createRun(opts, io);
  const r = launchWorker(folder, ctx, io);
  printStarted(r, io, 'Started');
  return { code: EXIT.OK, summary: r };
}

// `resume <run>`: restarts a stopped run in a worker. `--worker` is that worker
// itself: no terminal, so it pauses at any gate still open.
export async function resumeCommand({ runId, worker, grant }, io, { findRun, continueRun, context }) {
  if (!runId) throw new InspectError('E_USAGE', 'usage: shrine-inspect resume <run>', { exit: EXIT.USAGE });
  const ctx = context(io);
  const folder = findRun(ctx.dirs.state, runId);
  const state = readJson(folder.path('state.json'));
  if (folder.isDone('report')) throw new InspectError('E_RUN_DONE', `run ${runId} is finished`, { hint: `see it with: shrine-inspect status ${runId}`, exit: EXIT.USAGE });
  // The history changed after the Gate B yes: that yes no longer holds, so the run never continues.
  if (state.phase === 'scope_changed') {
    throw new InspectError('E_RUN_STOPPED', `run ${runId} stopped because the history changed since Gate B; nothing was resumed`, { hint: 'start a new run: shrine-inspect start --tier T1', exit: EXIT.USAGE });
  }
  // One runner per run: another live process (not this one, which its parent may
  // already have recorded) means busy.
  const other = workerPid(folder);
  if (other && other !== process.pid) throw busy(runId, other);
  // A run paused at a gate continues only through `approve`, typed by a person.
  const gate = openGate(state);
  if (gate) {
    throw new InspectError('E_GATE_WAITING', `run ${runId} is waiting at Gate ${gate}; nothing was resumed`, { hint: `answer in your own terminal: ${GATE_HINT[gate](runId)}`, exit: EXIT.GATE_WAITING });
  }
  if (judgingPending(folder, state)) {
    const g = state.grant;
    if (!grant || !g || grant !== g.token || !(Date.now() - g.at < GRANT_TTL_MS)) {
      throw new InspectError('E_NEEDS_YES', `run ${runId} has judging left to do, which needs a fresh yes; nothing was judged now`, { hint: `answer in your own terminal: shrine-inspect approve ${runId} B --background`, exit: EXIT.GATE_WAITING });
    }
  }
  if (state.grant) {
    delete state.grant;
    folder.writeJson('state.json', state);
  }
  if (!worker) {
    const r = launchWorker(folder, ctx, io);
    printStarted(r, io, 'Resumed');
    return { code: EXIT.OK, summary: r };
  }
  // continueRun runs as this run's runner and removes worker.pid on exit, so a
  // reused pid can never look like this worker.
  return continueRun(folder, ctx, { ...io, stdin: { isTTY: false } });
}

const GATE_HINT = {
  A: (id) => `shrine-inspect approve ${id} A <no-history|history> --background`,
  B: (id) => `shrine-inspect approve ${id} B <T0|T1> --background`,
  C: (id) => `shrine-inspect approve ${id} C <keep|stop> --background`,
};

// Where a run is: running, waiting at a gate, done, stopped, or died (no live
// worker, no report, not waiting at a gate). Reads the run folder only.
export function runStatus(folder) {
  const state = readJson(folder.path('state.json'));
  const id = state.run_id;
  const done = PHASES.filter((p) => folder.isDone(p));
  const out = { run_id: id, tier: state.tier, phase: done.at(-1) ?? 'created', state: null, gate: null, next: null, pid: null, log: exists(folder.path(LOG)) ? folder.path(LOG) : null, run_dir: folder.dir };
  if (exists(folder.path('workorder.json')) && !folder.isDone('judgments')) {
    const order = readJson(folder.path('workorder.json'));
    const p = folder.path('judgments.jsonl');
    const lines = exists(p) ? readText(p).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    out.judging = { judged: judgedIds(lines).size, planned: order.items.length, cut_off: cutOffCount(lines) };
  }
  if (folder.isDone('report')) {
    return { ...out, state: 'done', report: folder.path('report.html'), share_safe: folder.path('report.share-safe.html') };
  }
  const pid = workerPid(folder);
  if (pid) return { ...out, state: 'running', pid };
  const gate = openGate(state);
  if (gate) return { ...out, state: 'gate', gate, next: GATE_HINT[gate](id) };
  if (state.phase === 'scope_changed') return { ...out, state: 'stopped', next: 'shrine-inspect start --tier T1' };
  return { ...out, state: 'died', next: judgingPending(folder, state) ? `shrine-inspect approve ${id} B --background` : `shrine-inspect resume ${id}` };
}

function newestRun(stateDir) {
  const runs = join(stateDir, 'runs');
  const ids = list(runs).filter((e) => e.dir && exists(join(runs, e.name, 'state.json'))).map((e) => e.name).sort();
  if (!ids.length) throw new InspectError('E_NO_RUN', 'no runs yet', { hint: 'start one with: shrine-inspect start --tier T0', exit: EXIT.USAGE });
  return ids.at(-1);
}

// Episodes the time box cut off are named apart, never as failed answers.
const cutNote = (s) => (s.judging?.cut_off ? `, ${s.judging.cut_off} cut off by the time limit` : '');

const STATE_LINE = {
  running: (s) => `running (${s.judging ? `judging ${s.judging.judged} of ${s.judging.planned} episodes${cutNote(s)}` : `last phase done: ${s.phase}`})`,
  gate: (s) => `waiting at Gate ${s.gate} for your answer${cutNote(s)}`,
  done: () => 'done',
  stopped: () => 'stopped: the history changed since Gate B, so nothing was judged',
  died: (s) => `stopped before its report (last phase done: ${s.phase})${cutNote(s)}`,
};

export function statusCommand({ runId }, io, { findRun, context }) {
  const ctx = context(io);
  const id = runId ?? newestRun(ctx.dirs.state);
  const s = runStatus(findRun(ctx.dirs.state, id));
  if (io.json) io.stdout.write(`${JSON.stringify(s)}\n`);
  else {
    io.stdout.write(`Run ${s.run_id} (${s.tier}): ${STATE_LINE[s.state](s)}\n`);
    if (s.state === 'gate') io.stdout.write(`Answer in your own terminal: ${s.next}\n`);
    else if (s.next) io.stdout.write(`Next: ${s.next}\n`);
    if (s.report) io.stdout.write(`Report: ${s.report}\nShare-safe copy: ${s.share_safe}\n`);
    if (s.log) io.stdout.write(`Log: ${s.log}\n`);
  }
  return { code: EXIT.OK, summary: s };
}
