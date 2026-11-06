// Argument parsing and dispatch; returns the process exit code.
import { InspectError, EXIT } from './errors.mjs';
import { runCommand, continueRun, createRun, findRun, context } from './run.mjs';
import { approveCommand } from './approve.mjs';
import { purgeCommand } from './purge.mjs';
import { checkShareCommand } from './checkshare.mjs';
import { GRANT_ENV, resumeCommand, startCommand, statusCommand } from './background.mjs';
import { TOOL_VERSION } from '../scorer/score.mjs';

const USAGE = `usage:
  shrine-inspect run --tier T0|T1 [--no-history] [--session-id <id>] [--json]
  shrine-inspect start --tier T0|T1 [--no-history] [--session-id <id>] [--json]
  shrine-inspect status [<run>] [--json]
  shrine-inspect approve <run> <A|B|C> [choice] [--background]
  shrine-inspect resume <run> [--json]
  shrine-inspect check-share [<run> | <report.share-safe.html>] [--json]
  shrine-inspect purge [--json]
  shrine-inspect version
  shrine-inspect --help
Any command takes --skill-version <v>: a mismatch with this CLI stops before any read.`;

// Every command, for the skill test: the skill names only these.
export const COMMANDS = Object.freeze(['run', 'start', 'status', 'approve', 'resume', 'check-share', 'purge', 'version']);

export function parseArgs(argv) {
  const out = { cmd: argv[0], positional: [], json: false, noHistory: false, tier: null, sessionId: null, background: false, worker: false, skillVersion: null };
  const value = (i, name) => {
    const v = argv[i];
    if (!v || v.startsWith('--')) throw new InspectError('E_USAGE', `${name} needs a value`, { hint: USAGE, exit: EXIT.USAGE });
    return v;
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--background') out.background = true;
    // --worker: set only by this CLI when it starts its own worker.
    else if (a === '--worker') out.worker = true;
    else if (a === '--skill-version') out.skillVersion = value(++i, '--skill-version');
    else if (a.startsWith('--skill-version=')) out.skillVersion = a.slice(16);
    else if (a === '--no-history') out.noHistory = true;
    else if (a === '--session-id' || a.startsWith('--session-id=')) {
      // A value never starts with "-": "--session-id --skill-version 0.1.0" (an
      // empty session variable) must not swallow the next flag and skip the
      // version check.
      out.sessionId = a.includes('=') ? a.slice(13) : argv[++i];
      if (!out.sessionId || !/^[A-Za-z0-9][\w-]*$/.test(out.sessionId)) throw new InspectError('E_USAGE', 'bad --session-id', { hint: USAGE, exit: EXIT.USAGE });
    }
    else if (a === '--tier') out.tier = argv[++i];
    else if (a.startsWith('--tier=')) out.tier = a.slice(7);
    else if (a.startsWith('--')) throw new InspectError('E_USAGE', `unknown option ${a}`, { hint: USAGE, exit: EXIT.USAGE });
    else out.positional.push(a);
  }
  return out;
}

export async function main(argv, io) {
  let json = argv.includes('--json');
  // Help: no command, --help, or -h anywhere prints usage and reads nothing.
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    io.stdout.write(`${USAGE}\n`);
    return EXIT.OK;
  }
  try {
    const args = parseArgs(argv);
    json = args.json;
    // Version handshake: a skill from another release stops here, before any read.
    if (args.skillVersion !== null && args.skillVersion !== TOOL_VERSION) {
      throw new InspectError('E_VERSION', `this skill is for shrine-inspect ${args.skillVersion}, but the installed CLI is ${TOOL_VERSION}`, { hint: 'install the skill and the CLI from the same release (see TRIAL.md)', exit: EXIT.USAGE });
    }
    if (args.background && args.cmd !== 'approve') {
      throw new InspectError('E_USAGE', '--background goes with approve; start already runs in the background', { hint: USAGE, exit: EXIT.USAGE });
    }
    // A worker's one-time grant comes in its environment, never in argv, and is
    // dropped from the environment passed on (to a judge, or a later worker).
    const { [GRANT_ENV]: grant, ...env } = io.env ?? {};
    // Git children read process.env: the grant leaves it too.
    delete process.env[GRANT_ENV];
    const cio = { ...io, env, json, background: args.background };
    const deps = { findRun, continueRun, context };
    if (args.cmd === 'version') {
      io.stdout.write(json ? `${JSON.stringify({ version: TOOL_VERSION })}\n` : `shrine-inspect ${TOOL_VERSION}\n`);
      return EXIT.OK;
    }
    if (args.cmd === 'run') return (await runCommand(args, cio)).code;
    if (args.cmd === 'start') return startCommand(args, cio, { createRun }).code;
    if (args.cmd === 'status') return statusCommand({ runId: args.positional[0] }, cio, deps).code;
    if (args.cmd === 'resume') return (await resumeCommand({ runId: args.positional[0], worker: args.worker, grant: args.worker ? grant ?? null : null }, cio, deps)).code;
    if (args.cmd === 'approve') {
      const [runId, gate, choice] = args.positional;
      return (await approveCommand({ runId, gate, choice }, cio, deps)).code;
    }
    if (args.cmd === 'check-share') return checkShareCommand({ target: args.positional[0] }, cio, deps).code;
    if (args.cmd === 'purge') return purgeCommand(cio, { context }).code;
    throw new InspectError('E_USAGE', args.cmd ? `unknown command ${args.cmd}` : 'no command', { hint: USAGE, exit: EXIT.USAGE });
  } catch (e) {
    const err = e instanceof InspectError ? e : new InspectError('E_INTERNAL', e?.message ?? String(e), { hint: 'please report this with the run folder' });
    if (json) io.stderr.write(`${JSON.stringify(err.toJSON())}\n`);
    else io.stderr.write(`shrine-inspect: ${err.message}${err.hint ? `\n${err.hint}` : ''}\n`);
    return err.exit;
  }
}
