// Argument parsing and dispatch; returns the process exit code.
import { InspectError, EXIT } from './errors.mjs';
import { runCommand, continueRun, findRun, context } from './run.mjs';
import { approveCommand } from './approve.mjs';
import { purgeCommand } from './purge.mjs';

const USAGE = `usage:
  shrine-inspect run --tier T0 [--no-history] [--json]
  shrine-inspect approve <run> <gate> [choice]
  shrine-inspect purge [--json]`;

export function parseArgs(argv) {
  const out = { cmd: argv[0], positional: [], json: false, noHistory: false, tier: null };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--no-history') out.noHistory = true;
    else if (a === '--tier') out.tier = argv[++i];
    else if (a.startsWith('--tier=')) out.tier = a.slice(7);
    else if (a.startsWith('--')) throw new InspectError('E_USAGE', `unknown option ${a}`, { hint: USAGE, exit: EXIT.USAGE });
    else out.positional.push(a);
  }
  return out;
}

export async function main(argv, io) {
  let json = argv.includes('--json');
  try {
    const args = parseArgs(argv);
    json = args.json;
    const cio = { ...io, json };
    if (args.cmd === 'run') return (await runCommand(args, cio)).code;
    if (args.cmd === 'approve') {
      const [runId, gate, choice] = args.positional;
      return (await approveCommand({ runId, gate, choice }, cio, { findRun, continueRun, context })).code;
    }
    if (args.cmd === 'purge') return purgeCommand(cio, { context }).code;
    throw new InspectError('E_USAGE', args.cmd ? `unknown command ${args.cmd}` : 'no command', { hint: USAGE, exit: EXIT.USAGE });
  } catch (e) {
    const err = e instanceof InspectError ? e : new InspectError('E_INTERNAL', e?.message ?? String(e), { hint: 'please report this with the run folder' });
    if (json) io.stderr.write(`${JSON.stringify(err.toJSON())}\n`);
    else io.stderr.write(`shrine-inspect: ${err.message}${err.hint ? `\n${err.hint}` : ''}\n`);
    return err.exit;
  }
}
