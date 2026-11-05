// `approve <run> <gate> [choice]`: answers a gate in the user's own terminal and
// resumes the run. Piped stdin is refused (E_NOT_TTY, exit 3). There is no
// default answer.
import { readJson } from '../io/fsread.mjs';
import { prompt } from '../io/tty.mjs';
import { InspectError, EXIT } from './errors.mjs';

export const GATE_A = {
  question: 'Read session history too? T0 never sends anything to a model.',
  choices: ['no-history', 'history'],
};
export const GATE_B_NOTE = 'Tier: T0, scan only, no model calls. Deeper tiers are not available in this version.';

const day = (iso) => (iso ? iso.slice(0, 10) : 'none');
const size = (bytes) => (bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : bytes >= 1 << 20 ? `${Math.round(bytes / (1 << 20))} MB` : `${Math.round(bytes / 1024)} KB`);
const eta = (s) => (s < 60 ? 'under 1 minute' : `about ${Math.ceil(s / 60)} minutes`);

const describe = (gate) => {
  const lines = [`Gate ${gate.gate}: ${gate.question}`];
  if (gate.projects?.length) {
    lines.push('Projects in scope (top by size):');
    for (const p of gate.projects) lines.push(`  ${p.name}: ${p.sessions} session files, ${Math.round(p.bytes / 1024)} KB`);
    if (gate.more) lines.push(`  and ${gate.more} more`);
  }
  if (gate.excluded) lines.push(`Excluded (temp, scratch, sdk-cli automation): ${gate.excluded} folders`);
  lines.push('Read so far: file names, sizes, and dates, plus the cwd, entrypoint, and version keys from the first 10 lines of the newest session file per folder. No prompt is read before you answer.');
  const h = gate.history;
  if (h) {
    lines.push(`History if yes: ${h.sessions} session files in ${h.projects} ${h.projects === 1 ? 'project' : 'projects'}, ${day(h.from)} to ${day(h.to)} (last ${h.window_days} days), ${size(h.bytes)} on disk.`);
    lines.push(`Estimated time with history: ${eta(h.estimate_seconds)} to parse, from file size at a rate measured during development (a lower bound). Read locally; nothing leaves it.`);
  }
  if (h?.recheck_sessions) lines.push(`If yes, ${h.recheck_sessions} session files in excluded automation, temp, and scratch folders are re-checked from their first lines; only interactive sessions outside temp folders are read in full.`);
  if (gate.own_session) lines.push(`Left out: session ${gate.own_session.id.slice(0, 8)} (${gate.own_session.reason === 'flag' ? 'named by --session-id' : 'still being written, likely the one running this'}).`);
  if (gate.tier?.note) lines.push(gate.tier.note);
  lines.push(`Choices: ${gate.choices.join(', ')}`);
  return lines.join('\n');
};

// Shared by `approve` and by `run` in a TTY (same code path).
export async function askGate(gate, choice, io) {
  if (choice && !gate.choices.includes(choice)) {
    throw new InspectError('E_CHOICE', `unknown choice ${choice}`, { hint: `one of: ${gate.choices.join(', ')}`, exit: EXIT.USAGE });
  }
  io.stderr.write(`${describe(gate)}\n`);
  const q = choice ? `Confirm ${choice}? Type yes to confirm: ` : `Type one of ${gate.choices.join(', ')}: `;
  const answer = (await prompt(q, { input: io.stdin, output: io.stderr })).toLowerCase();
  const picked = choice ? (answer === 'yes' || answer === 'y' ? choice : null) : gate.choices.includes(answer) ? answer : null;
  if (!picked) throw new InspectError('E_NOT_ANSWERED', `Gate ${gate.gate} was not answered; the run stays paused`, { exit: EXIT.GATE_WAITING });
  return { choice: picked, by: 'tty', at: new Date().toISOString() };
}

export async function approveCommand({ runId, gate, choice }, io, { findRun, continueRun, context }) {
  if (!runId || !gate) throw new InspectError('E_USAGE', 'usage: shrine-inspect approve <run> <gate> [choice]', { exit: EXIT.USAGE });
  if (!io.stdin.isTTY) {
    throw new InspectError('E_NOT_TTY', 'gates are answered only in your own terminal', {
      hint: `run this in an interactive terminal: shrine-inspect approve ${runId} ${gate}`,
      exit: EXIT.GATE_WAITING,
    });
  }
  const ctx = context(io);
  const folder = findRun(ctx.dirs.state, runId);
  const state = readJson(folder.path('state.json'));
  if (gate !== 'A') throw new InspectError('E_GATE', `gate ${gate} does not exist at T0`, { exit: EXIT.USAGE });
  if (state.gates.A) throw new InspectError('E_GATE_ANSWERED', `Gate A of run ${runId} is already answered`, { exit: EXIT.USAGE });
  const g = readJson(folder.path('gate.json'));
  state.gates.A = await askGate(g, choice, io);
  folder.writeJson('state.json', state);
  return continueRun(folder, ctx, io);
}
