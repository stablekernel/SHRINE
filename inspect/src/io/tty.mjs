// Plain TTY prompt. Gates are answered only by a person at their own terminal,
// so piped stdin is refused (spec 2).
import { createInterface } from 'node:readline/promises';
import { InspectError, EXIT } from '../cli/errors.mjs';

export async function prompt(question, { input = process.stdin, output = process.stderr } = {}) {
  if (!input.isTTY) {
    throw new InspectError('E_NOT_TTY', 'gates are answered only in your own terminal', {
      hint: 'run `shrine-inspect approve <run> <gate>` in an interactive terminal',
      exit: EXIT.GATE_WAITING,
    });
  }
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
