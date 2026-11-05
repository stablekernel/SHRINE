// Allowlisted read-only git (spec 7): log, show, diff, rev-parse, status --porcelain.
import { runSync } from './proc.mjs';
import { InspectError } from '../cli/errors.mjs';

const ALLOWED = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);
const DIFFING = new Set(['log', 'show', 'diff']);
const WRITING_FLAGS = /^(--output|-o$|--ext-diff|--textconv)/;

function deny(args, why) {
  throw new InspectError('E_GIT_DENIED', `refused git ${args.join(' ')}: ${why}`);
}

export function gitInvocation(args, cwd) {
  const sub = args[0];
  if (!ALLOWED.has(sub)) deny(args, 'subcommand not on the allowlist');
  if (sub === 'status' && !args.includes('--porcelain')) deny(args, 'status needs --porcelain');
  if (args.some((a) => WRITING_FLAGS.test(a))) deny(args, 'flag can write or run code');
  // Commands that can render a diff never run an external diff or textconv program,
  // whether it comes from repo config or the environment.
  const noPrograms = DIFFING.has(sub) ? ['--no-ext-diff', '--no-textconv'] : [];
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_EXTERNAL_DIFF;
  return {
    cmd: 'git',
    args: ['--no-pager', '-c', 'core.fsmonitor=false', sub, ...noPrograms, ...args.slice(1)],
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
