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
export const GATE_B_NOTE = 'Tier: T0, scan only, no model calls. Run with --tier T1 to be offered judging at Gate B.';
export const GATE_C = {
  question: 'Judging stopped early. Keep the partial results, or stop and keep the scan only?',
  choices: ['keep', 'stop'],
};
const ABORT_REASON = {
  tokens: 'tokens passed the approved upper bound',
  time: 'judging ran past its time box plus 50%',
  errors: 'more than 10% of judge answers were invalid',
  limit: 'your harness reported a usage or rate limit',
};
export const abortReason = (r) => ABORT_REASON[r] ?? r;

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
  if (gate.gate === 'A') lines.push('Read so far: file names, sizes, and dates. Also, the first 10 lines of the newest session file per folder are read to find its folder; these lines can hold a prompt. Only the folder, entry point, and version are kept; no prompt text is kept or shown.');
  const h = gate.history;
  if (h) {
    lines.push(`History if yes: ${h.sessions} session files in ${h.projects} ${h.projects === 1 ? 'project' : 'projects'}, ${day(h.from)} to ${day(h.to)} (last ${h.window_days} days), ${size(h.bytes)} on disk.`);
    lines.push(`Estimated time with history: ${eta(h.estimate_seconds)} to parse, from file size at a rate measured during development (a lower bound). Read locally; nothing leaves it.`);
  }
  if (h?.recheck_sessions) lines.push(`If yes, ${h.recheck_sessions} session files in excluded automation, temp, and scratch folders are re-checked from their first lines; only interactive sessions outside temp folders are read in full.`);
  if (gate.own_session) lines.push(`Left out: session ${gate.own_session.id.slice(0, 8)} (${gate.own_session.reason === 'flag' ? 'named by --session-id' : 'still being written, likely the one running this'}).`);
  if (gate.tier?.note) lines.push(gate.tier.note);
  for (const l of gate.lines ?? []) lines.push(l);
  lines.push(`Choices: ${gate.choices.join(', ')}`);
  return lines.join('\n');
};

// Gate B for a T1 run: the itemized offer, T0 pre-selected. One question: T0
// keeps the scan only; T1 needs a typed yes. Anything else, silence included,
// leaves the run paused with no judge spawned.
export async function askGateB(gate, choice, io) {
  if (choice && !gate.choices.includes(choice)) {
    throw new InspectError('E_CHOICE', `unknown choice ${choice}`, { hint: `one of: ${gate.choices.join(', ')}`, exit: EXIT.USAGE });
  }
  io.stderr.write(`Gate B: pick a depth.\n${gate.lines.join('\n')}\n`);
  const t1 = gate.choices.includes('T1');
  const q = choice === 'T1'
    ? `Approve T1 (about ${gate.offer.tokens_low.toLocaleString('en-US')} to ${gate.offer.tokens_high.toLocaleString('en-US')} tokens on your own account)? Type yes: `
    : choice === 'T0'
      ? 'Confirm T0, scan only? Type yes: '
      : t1
        ? 'Type yes to approve T1, or T0 for the scan only: '
        : 'Type T0 to continue with the scan only: ';
  const answer = (await prompt(q, { input: io.stdin, output: io.stderr })).trim();
  const yes = /^(yes|y)$/i.test(answer);
  let picked = null;
  if (choice) picked = yes ? choice : null;
  else if (t1 && yes) picked = 'T1';
  else if (/^t0$/i.test(answer)) picked = 'T0';
  if (!picked) throw new InspectError('E_NOT_ANSWERED', 'Gate B was not answered; the run stays paused and no model was called', { exit: EXIT.GATE_WAITING });
  const at = new Date().toISOString();
  return picked === 'T1' ? { choice: 'T1', by: 'tty', at, episodes: gate.offer.episodes, estimate: { tokens_low: gate.offer.tokens_low, tokens_high: gate.offer.tokens_high, minutes: gate.offer.minutes } } : { choice: 'T0', by: 'tty', at };
}

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
  if (!['A', 'B', 'C'].includes(gate)) throw new InspectError('E_GATE', `gate ${gate} does not exist`, { exit: EXIT.USAGE });
  if (state.gates[gate]) throw new InspectError('E_GATE_ANSWERED', `Gate ${gate} of run ${runId} is already answered`, { exit: EXIT.USAGE });
  const g = readJson(folder.path('gate.json'));
  if (g.gate !== gate) throw new InspectError('E_GATE', `run ${runId} is waiting at Gate ${g.gate}, not Gate ${gate}`, { exit: EXIT.USAGE });
  state.gates[gate] = gate === 'B' ? await askGateB(g, choice, io) : await askGate(g, choice, io);
  folder.writeJson('state.json', state);
  return continueRun(folder, ctx, io);
}
