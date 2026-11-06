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
  // Silence is no answer: input that already ended, or ends (Ctrl-D) before a
  // line, resolves to '' so the caller leaves the gate paused. A pending
  // question on an ended stream would otherwise never settle.
  if (input.readableEnded || input.destroyed) {
    output.write(`${question}\n`);
    return '';
  }
  const rl = createInterface({ input, output });
  try {
    output.write(question);
    return await new Promise((resolve) => {
      rl.once('line', (a) => resolve(a.trim()));
      rl.once('close', () => resolve(''));
    });
  } finally {
    rl.close();
  }
}
