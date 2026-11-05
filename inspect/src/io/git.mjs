// Allowlisted read-only git (spec 7): log, show, diff, rev-parse, status --porcelain.
import { runSync } from './proc.mjs';
import { InspectError } from '../cli/errors.mjs';

const ALLOWED = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);
const DIFFING = new Set(['log', 'show', 'diff']);
const KEEP_ENV = new Set(['GIT_CEILING_DIRECTORIES']);
const WRITING_FLAGS =/^(--output|-o$|--ext-diff|--textconv)/;
const NO_PROTOCOL = 'none';
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
  if (!ALLOWED.has(sub)) deny(args, 'subcommand not on the allowlist');
  if (sub === 'status' && !args.includes('--porcelain')) deny(args, 'status needs --porcelain');
  if (args.some((a) => WRITING_FLAGS.test(a))) deny(args, 'flag can write or run code');
  // Commands that can render a diff never run an external diff or textconv program,
  // whether it comes from repo config or the environment; signature checks (which
  // run gpg.program) are off for every command.
  const noPrograms = DIFFING.has(sub) ? ['--no-ext-diff', '--no-textconv'] : [];
  // Partial clones never lazy-fetch: GIT_NO_LAZY_FETCH (git 2.44.1+). Older git
  // ignores that var, so every transport is refused too. Repo config can set
  // protocol.<name>.allow=always, which beats -c protocol.allow=never, so the real
  // guard is GIT_ALLOW_PROTOCOL: set, it overrides all protocol config, and naming
  // only a protocol that does not exist allows none. -c per protocol backs it up.
  // Caller GIT_* vars (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*, GIT_ALLOW_PROTOCOL, ...)
  // are dropped first so nothing redirects the repo, injects config or re-allows a
  // transport; the ceiling only narrows discovery.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || KEEP_ENV.has(k)));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: NO_PROTOCOL });
  return {
    cmd: 'git',
    args: ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', ...NO_TRANSPORT, ...NO_BUNDLES, sub, ...noPrograms, ...args.slice(1)],
    env,
    cwd,
  };
}

export function git(args, { cwd }) {
  const inv = gitInvocation(args, cwd);
  const r = runSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env });
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
