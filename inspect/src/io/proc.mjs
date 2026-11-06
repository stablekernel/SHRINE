// The only module that spawns processes. Allowlist: git, a self-spawn of this
// package's own bin (for `start` in SP3), and the adapter's judge command, which
// is allowed only after armJudge() finds a Gate B yes for T1 in facts.json.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, record } from './fsread.mjs';
import { InspectError } from '../cli/errors.mjs';

export const OWN_BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));

// The judge command and its first argument, set by armJudge(); null otherwise.
let armed = null;

export function checkSpawn(cmd, args) {
  if (cmd === 'git') return;
  if (cmd === process.execPath && args[0] === OWN_BIN) return;
  if (armed && cmd === armed.cmd && args[0] === armed.first) return;
  throw new InspectError('E_SPAWN_DENIED', `refused to spawn ${cmd}`);
}

// Allows the judge command only when the run's facts.json records a Gate B
// answer of T1 typed in a terminal. Anything else leaves it denied.
export function armJudge(factsPath, { cmd, args }) {
  let consent = null;
  try {
    consent = readJson(factsPath)?.consent?.B ?? null;
  } catch {}
  if (!consent || consent.choice !== 'T1' || consent.by !== 'tty') {
    armed = null;
    throw new InspectError('E_SPAWN_DENIED', 'judging needs a Gate B yes for T1 in facts.json');
  }
  armed = { cmd, first: args[0] };
}
export function disarmJudge() {
  armed = null;
}

// True when a process with this pid exists (EPERM: it exists, owned by another user).
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// A background worker: this package's own bin, detached from the terminal (its
// own session, so closing the terminal does not stop it), stdout and stderr
// appended to logFd, stdin closed. Returns the child pid.
export function spawnWorker(args, { env, cwd, logFd }) {
  const argv = [OWN_BIN, ...args];
  checkSpawn(process.execPath, argv);
  const t_start = Date.now();
  const child = spawn(process.execPath, argv, { cwd, env, detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
  child.unref();
  record({ op: 'spawn', cmd: process.execPath, args: logArgs(argv), cwd, mode: 'x', t_start, worker: true });
  return child.pid;
}

// Long arguments (the judge schema and prompt) are logged by size only.
const logArgs = (args) => args.map((a) => (a.length > 120 ? `<${a.length} chars>` : a));

// One judge process: input on stdin, stdout read up to maxStdout bytes, killed at
// timeoutMs. Resolves {status, stdout, stderr, timedOut, truncated, ms}; never rejects.
export function runJudge({ cmd, args, env, cwd, input, timeoutMs = 180_000, maxStdout = 256 << 10 }) {
  checkSpawn(cmd, args);
  const t_start = Date.now();
  return new Promise((resolve) => {
    const chunks = [];
    let bytes = 0;
    let err = '';
    let truncated = false;
    let timedOut = false;
    let child;
    let timer = null;
    let finished = false;
    const done = (status, error = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      record({ op: 'spawn', cmd, args: logArgs(args), cwd, mode: 'x', t_start, judge: true });
      resolve({ status, stdout: Buffer.concat(chunks).toString('utf8'), stderr: err.slice(0, 4096), timedOut, truncated, error, ms: Date.now() - t_start });
    };
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return done(null, e?.code ?? 'spawn failed');
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (truncated) return;
      if (bytes + d.length > maxStdout) {
        truncated = true;
        chunks.push(d.subarray(0, Math.max(0, maxStdout - bytes)));
        bytes = maxStdout;
        child.kill('SIGKILL');
      } else {
        chunks.push(d);
        bytes += d.length;
      }
    });
    child.stderr.on('data', (d) => {
      if (err.length < 4096) err += d;
    });
    child.on('error', (e) => done(null, e?.code ?? 'spawn failed'));
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// A child that never exits (git blocked reading a FIFO named by a repo's
// include.path, say) would hang the run, so every spawn has a time limit. A run
// that hits it is killed and reported as timed out, a failed read.
export const SPAWN_TIMEOUT_MS = 60_000;
let timeoutMs = SPAWN_TIMEOUT_MS;
// Test seam: a shorter limit (ms), or the default when called with no value.
export function setSpawnTimeout(ms = SPAWN_TIMEOUT_MS) {
  timeoutMs = ms;
}
export const spawnTimeoutMs = () => timeoutMs;

export function runSync(cmd, args, { cwd, env } = {}) {
  checkSpawn(cmd, args);
  // t_start and the entry's own t (end) bound the run, so the verifier can tell
  // a .git change made during an inspect git run from one made between runs.
  const t_start = Date.now();
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: timeoutMs, killSignal: 'SIGKILL' });
  record({ op: 'spawn', cmd, args, cwd, mode: 'x', t_start });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error, timedOut: r.error?.code === 'ETIMEDOUT' };
}
