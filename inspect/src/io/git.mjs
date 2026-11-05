// Allowlisted read-only git (spec 7): log, show, diff, rev-parse, status --porcelain.
import { runSync } from './proc.mjs';
import { InspectError } from '../cli/errors.mjs';

const ALLOWED = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);
const DIFFING = new Set(['log', 'show', 'diff']);
const KEEP_ENV = new Set(['GIT_CEILING_DIRECTORIES']);
const WRITING_FLAGS =/^(--output|-o$|--ext-diff|--textconv)/;

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
  // Partial clones never lazy-fetch: GIT_NO_LAZY_FETCH (git 2.44+), and every
  // transport is refused for older git.
  // Caller GIT_* vars (GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*, ...) are dropped so
  // nothing redirects the repo or injects config; the ceiling only narrows discovery.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') || KEEP_ENV.has(k)));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' });
  return {
    cmd: 'git',
    args: ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-c', 'protocol.allow=never', sub, ...noPrograms, ...args.slice(1)],
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
