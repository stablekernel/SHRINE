// Allowlisted read-only git (spec 7): log, show, diff, rev-parse, status --porcelain,
// plus three fixed reads: git --version, the promisor-config query, and the global-config probe below.
import { delimiter, dirname, join, parse, resolve } from 'node:path';
import { runSync } from './proc.mjs';
import { exists } from './fsread.mjs';
import { InspectError } from '../cli/errors.mjs';

const ALLOWED = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);
const DIFFING = new Set(['log', 'show', 'diff']);
// Commands that read commits, trees, or blobs, and so can lazy-fetch a missing one.
const HISTORY = new Set(['log', 'show', 'diff', 'status']);
// The only config read allowed: does this repo have a promisor remote (partial clone)?
const PROMISOR_QUERY = ['config', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$'];
// Reads only the system and global config (run outside any repo), for a key no one
// sets: it hangs only when that config blocks git (an include naming a pipe).
const GLOBAL_PROBE = ['config', '--get', 'shrineinspect.probe'];
const FIXED = [['--version'], PROMISOR_QUERY, GLOBAL_PROBE].map((a) => JSON.stringify(a));
const KEEP_ENV = new Set(['GIT_CEILING_DIRECTORIES']);
const WRITING_FLAGS =/^(--output|-o$|--ext-diff|--textconv)/;
// The allow list also names remote helpers (a "<name>::" URL runs git-remote-<name>).
// The underscore is not a URL scheme character, so no URL can name this one.
const NO_PROTOCOL = 'no_transport';
const NO_TRANSPORT = ['protocol.allow', ...['ext', 'file', 'ssh', 'git', 'http', 'https'].map((p) => `protocol.${p}.allow`)].flatMap((k) => ['-c', `${k}=never`]);
// A lazy fetch reads these before any transport check: fetch.bundleURI downloads and
// unbundles a pack (local path or http) even with every protocol refused, and
// transfer.bundleURI does the same on an advertised URI. Neither is honored here.
const NO_BUNDLES = ['-c', 'fetch.bundleURI=', '-c', 'transfer.bundleURI=false', '-c', 'fetch.writeCommitGraph=false'];

// Test seam: extra variables for every git run (GIT_TEST_ASSUME_DIFFERENT_OWNER, to
// make git refuse a repo as if another user owned it). Empty outside tests.
let testEnv = {};
export function setGitTestEnv(vars = {}) {
  testEnv = vars;
}

function deny(args, why) {
  throw new InspectError('E_GIT_DENIED', `refused git ${args.join(' ')}: ${why}`);
}

export function gitInvocation(args, cwd) {
  const sub = args[0];
  if (!ALLOWED.has(sub) && !FIXED.includes(JSON.stringify(args))) deny(args, 'subcommand not on the allowlist');
  if (sub === 'status' && !args.includes('--porcelain')) deny(args, 'status needs --porcelain');
  if (args.some((a) => WRITING_FLAGS.test(a))) deny(args, 'flag can write or run code');
  // Commands that can render a diff never run an external diff or textconv program,
  // whether it comes from repo config or the environment; signature checks (which
  // run gpg.program) are off for every command.
  const noPrograms = DIFFING.has(sub) ? ['--no-ext-diff', '--no-textconv'] : [];
  // Partial clones never lazy-fetch: GIT_NO_LAZY_FETCH (see gitVersion). Older git
  // ignores that var, so every transport is refused too. Repo config can set
  // protocol.<name>.allow=always, which beats -c protocol.allow=never, so the real
  // guard is GIT_ALLOW_PROTOCOL: set, it overrides all protocol config, and naming
  // only a protocol that does not exist allows none. -c per protocol backs it up.
  // safe.bareRepository=explicit: a bare repo planted inside a scanned project
  // (with its own config) is never picked up by discovery.
  // Caller GIT_* vars (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*, GIT_ALLOW_PROTOCOL, ...)
  // are dropped first so nothing redirects the repo, injects config or re-allows a
  // transport; the ceiling only narrows discovery.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || KEEP_ENV.has(k)));
  // LC_ALL=C keeps git's messages in English, so a refusal can be recognized.
  Object.assign(env, testEnv, { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: NO_PROTOCOL });
  return {
    cmd: 'git',
    args: ['--no-pager', '-c', 'safe.bareRepository=explicit', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...NO_TRANSPORT, ...NO_BUNDLES, sub, ...noPrograms, ...args.slice(1)],
    env,
    cwd,
  };
}

// GIT_NO_LAZY_FETCH came with the May 2024 security releases: 2.39.4, 2.40.2, 2.41.1,
// 2.42.2, 2.43.4, 2.44.1, 2.45.1, and every later release. Older git ignores it, and
// a partial clone's lazy fetch then applies fetch-time repo config before any
// transport check (bundle URIs were one such path). There, history is not read.
const FIRST_SAFE_PATCH = { 39: 4, 40: 2, 41: 1, 42: 2, 43: 4, 44: 1, 45: 1 };
let version;
export function gitVersion() {
  if (version === undefined && globalHang()) return null;
  if (version === undefined) {
    const inv = gitInvocation(['--version'], undefined);
    const m = runSync(inv.cmd, inv.args, { env: inv.env }).stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    version = m ? m.slice(1, 4).map(Number) : null;
  }
  return version;
}
// Test seam: pretend the running git is this version ([major, minor, patch] or null).
export function setGitVersion(v) {
  version = v;
  partial.clear();
}

export function honorsNoLazyFetch(v) {
  if (!v) return false;
  const [a, b, c] = v;
  if (a !== 2) return a > 2;
  if (b > 45) return true;
  return b in FIRST_SAFE_PATCH && c >= FIRST_SAFE_PATCH[b];
}
// The first release that honors GIT_NO_LAZY_FETCH on this git's line, for the note.
export function firstSafeGit(v) {
  const b = v?.[0] === 2 ? v[1] : null;
  return b in FIRST_SAFE_PATCH ? `2.${b}.${FIRST_SAFE_PATCH[b]}` : '2.39.4';
}

// The repo a folder belongs to: the nearest folder at or above it that holds .git
// (a folder, or a file for linked worktrees and submodules). Like git, the search
// does not enter a GIT_CEILING_DIRECTORIES folder. null outside any repo.
const roots = new Map();
export function enclosingRepo(cwd) {
  if (!cwd) return null;
  if (!roots.has(cwd)) {
    const ceilings = (process.env.GIT_CEILING_DIRECTORIES ?? '').split(delimiter).filter(Boolean).map((c) => resolve(c));
    let dir = resolve(cwd);
    let found = null;
    for (;;) {
      if (exists(join(dir, '.git'))) {
        found = dir;
        break;
      }
      const up = dirname(dir);
      if (up === dir || ceilings.includes(up)) break;
      dir = up;
    }
    roots.set(cwd, found);
  }
  return roots.get(cwd);
}
// Hung and refused marks are per repo: every folder under a repo shares its config
// and its owner.
const hungKey = (cwd) => enclosingRepo(cwd) ?? cwd;
export const isHung = (cwd) => globalHang() || timedOut.has(hungKey(cwd));
export const isRefused = (cwd) => refused.has(hungKey(cwd));
// Git refuses a repo owned by another user (safe.directory). The message is
// matched in the C locale, which every git run uses.
const REFUSAL = /detected dubious ownership/;
function noteFailure(r, cwd) {
  // Outside any repo git reads only the system and global config, so a time limit
  // there is theirs, and every git run would hit it.
  if (r.timedOut && !enclosingRepo(cwd)) globalHung = true;
  else if (r.timedOut) timedOut.add(hungKey(cwd));
  else if (r.status !== 0 && REFUSAL.test(r.stderr)) refused.add(hungKey(cwd));
  else return false;
  return true;
}

const partial = new Map();
// True when this repo has a promisor remote (a partial clone): the only kind of repo
// a read can lazy-fetch into. A hung or refused repo is not one: git is never run
// there again, and it is reported under its own reason.
export function isPartialClone(cwd) {
  if (!enclosingRepo(cwd) || isHung(cwd) || isRefused(cwd)) return false;
  if (!partial.has(cwd)) {
    const inv = gitInvocation(PROMISOR_QUERY, cwd);
    const r = runSync(inv.cmd, inv.args, { cwd, env: inv.env });
    if (noteFailure(r, cwd)) return false;
    // Exit 1 is "no such key"; any other failure counts as partial, to stay safe.
    partial.set(cwd, !(r.status === 1 || (r.status === 0 && !/\S/.test(r.stdout))));
  }
  return partial.get(cwd);
}

// True when git can read this repo's history without risking a lazy fetch.
export function historyReadable(cwd) {
  return honorsNoLazyFetch(gitVersion()) || !isPartialClone(cwd);
}

// Repo roots (or, outside a repo, folders) where a git run hit the spawn time limit.
// Later git runs anywhere under them are skipped as failed reads, so one hung repo
// costs one time limit, not one per folder or call.
const timedOut = new Set();
export function gitTimeouts() {
  return [...timedOut].filter((k) => enclosingRepo(k));
}

// The system or global git config blocks git (probed once per run, before any other
// git run, outside any repo): then every git run would hit the time limit, so none
// runs, and the run pays one time limit, not one per repo.
let globalHung;
export function globalHang() {
  if (globalHung === undefined) {
    globalHung = false;
    const root = parse(resolve('.')).root;
    const inv = gitInvocation(GLOBAL_PROBE, root);
    globalHung = Boolean(runSync(inv.cmd, inv.args, { cwd: root, env: inv.env }).timedOut);
  }
  return globalHung;
}
// Repo roots git refused to read (owned by another user).
const refused = new Set();
export function gitRefusals() {
  return [...refused];
}
// Each run starts with no repo marked as hung or refused.
export function resetGitTimeouts() {
  globalHung = undefined;
  partial.clear();
  roots.clear();
  timedOut.clear();
  refused.clear();
}

// failed: git could not read the repo (timed out, refused, skipped, or did not
// start), so its answer is unknown. A plain non-zero exit (not a repo, no commits
// yet) is an answer, not a failure.
export function git(args, { cwd }) {
  const inv = gitInvocation(args, cwd);
  // The partial-clone check runs first: its own git run can be the one that hangs or
  // is refused, and then the checks below skip this run.
  if (HISTORY.has(args[0]) && !historyReadable(cwd)) return { ok: false, stdout: '', stderr: 'history not read: partial clone on a git that can lazy-fetch', skipped: true, failed: true };
  if (isHung(cwd)) return { ok: false, stdout: '', stderr: 'git not run: an earlier git run in this repo timed out', skipped: true, timedOut: true, failed: true };
  if (isRefused(cwd)) return { ok: false, stdout: '', stderr: 'git not run: git refused this repo earlier', skipped: true, refused: true, failed: true };
  const r = runSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env });
  if (noteFailure(r, cwd)) return { ok: false, stdout: '', stderr: r.timedOut ? 'git timed out' : r.stderr, timedOut: r.timedOut, refused: !r.timedOut, failed: true };
  if (r.error) return { ok: false, stdout: '', stderr: String(r.error.message), failed: true };
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

// Convenience: trimmed stdout or null.
export function gitOut(args, cwd) {
  return gitRead(args, cwd).out;
}

// { out, failed }: out is trimmed stdout, or null when git did not answer; failed
// tells "git could not read this repo" (unknown) from "git answered with nothing".
export function gitRead(args, cwd) {
  try {
    const r = git(args, { cwd });
    return { out: r.ok ? r.stdout.trim() : null, failed: r.failed === true };
  } catch (e) {
    if (e.code === 'E_GIT_DENIED') throw e;
    return { out: null, failed: true };
  }
}
