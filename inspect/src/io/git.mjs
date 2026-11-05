// Allowlisted read-only git (spec 7): log, show, diff, rev-parse, status --porcelain,
// plus two fixed reads: git --version and the promisor-config query below.
import { delimiter, dirname, join, resolve } from 'node:path';
import { runSync } from './proc.mjs';
import { exists } from './fsread.mjs';
import { InspectError } from '../cli/errors.mjs';

const ALLOWED = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);
const DIFFING = new Set(['log', 'show', 'diff']);
// Commands that read commits, trees, or blobs, and so can lazy-fetch a missing one.
const HISTORY = new Set(['log', 'show', 'diff', 'status']);
// The only config read allowed: does this repo have a promisor remote (partial clone)?
const PROMISOR_QUERY = ['config', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.promisor)$'];
const FIXED = [['--version'], PROMISOR_QUERY].map((a) => JSON.stringify(a));
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
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: NO_PROTOCOL });
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
// Hung marks are per repo: every folder under a hung repo shares its config.
const hungKey = (cwd) => enclosingRepo(cwd) ?? cwd;
export const isHung = (cwd) => timedOut.has(hungKey(cwd));

const partial = new Map();
// True when this repo has a promisor remote (a partial clone): the only kind of repo
// a read can lazy-fetch into.
export function isPartialClone(cwd) {
  if (!partial.has(cwd) && isHung(cwd)) partial.set(cwd, true);
  if (!partial.has(cwd)) {
    const inv = gitInvocation(PROMISOR_QUERY, cwd);
    const r = runSync(inv.cmd, inv.args, { cwd, env: inv.env });
    if (r.timedOut) timedOut.add(hungKey(cwd));
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
  return [...timedOut];
}
// Each run starts with no repo marked as hung.
export function resetGitTimeouts() {
  partial.clear();
  roots.clear();
  timedOut.clear();
}

export function git(args, { cwd }) {
  const inv = gitInvocation(args, cwd);
  if (isHung(cwd)) return { ok: false, stdout: '', stderr: 'git not run: an earlier git run in this repo timed out', skipped: true, timedOut: true };
  if (HISTORY.has(args[0]) && !historyReadable(cwd)) return { ok: false, stdout: '', stderr: 'history not read: partial clone on a git that can lazy-fetch', skipped: true };
  const r = runSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env });
  if (r.timedOut) {
    timedOut.add(hungKey(cwd));
    return { ok: false, stdout: '', stderr: 'git timed out', timedOut: true };
  }
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

// Convenience: trimmed stdout or null.
export function gitOut(args, cwd) {
  try {
    const r = git(args, { cwd });
    return r.ok ? r.stdout.trim() : null;
  } catch (e) {
    if (e.code === 'E_GIT_DENIED') throw e;
    return null;
  }
}
