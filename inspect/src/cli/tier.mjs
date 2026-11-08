// `run` with no --tier: asks which tier, only in an interactive terminal (the
// same check as the gates). The answer picks the tier only; it is never Gate B
// consent, so a T1 run still stops at Gate A and Gate B as with --tier T1.
// `start`, piped stdin, and skills get a usage error that names the flag: no
// silent default, no hang.
import { askUntil, isTerminal } from '../io/tty.mjs';
import { InspectError, EXIT } from './errors.mjs';

export const TIER_MENU = [
  'Pick a tier for this run:',
  '  T0: scan only. No model calls, nothing leaves your machine.',
  '  T1: T0 plus up to 12 judged episodes, sent with your own Claude Code login. Gate B shows the estimate before anything is sent.',
  'Picking T1 here is not consent: Gate B still asks for a typed yes.',
];
const QUESTION = 'Type T0 or T1: ';
const ATTEMPTS = 3;

export const tierRequired = (cmd) =>
  new InspectError('E_TIER_REQUIRED', `${cmd} needs --tier T0|T1 here`, {
    hint: cmd === 'start'
      ? 'start runs in the background, so it never asks: shrine-inspect start --tier T0'
      : 'the tier is asked only in an interactive terminal; else pass it: shrine-inspect run --tier T0',
    exit: EXIT.USAGE,
  });

// Returns 'T0' or 'T1'. Throws E_TIER_REQUIRED with no terminal, and
// E_TIER_NOT_CHOSEN on Ctrl-D or after ATTEMPTS wrong answers.
export async function askTier(io) {
  if (!isTerminal(io.stdin)) throw tierRequired('run');
  io.stderr.write(`${TIER_MENU.join('\n')}\n`);
  const tier = await askUntil(QUESTION, (a) => (/^t[01]$/i.test(a) ? a.toUpperCase() : null), {
    input: io.stdin,
    output: io.stderr,
    attempts: ATTEMPTS,
    again: (a) => (a ? `not ${a}.` : 'no answer.'),
  });
  if (!tier) {
    throw new InspectError('E_TIER_NOT_CHOSEN', 'no tier chosen; no run was created', { hint: 'run again and type T0 or T1, or pass --tier T0|T1', exit: EXIT.USAGE });
  }
  return tier;
}
