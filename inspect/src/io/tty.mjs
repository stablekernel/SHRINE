// Plain TTY prompt. Gates are answered only by a person at their own terminal,
// so piped stdin is refused (spec 2).
import { createInterface } from 'node:readline/promises';
import { InspectError, EXIT } from '../cli/errors.mjs';

// The one interactive-terminal check: every question this CLI asks uses it.
export const isTerminal = (input) => Boolean(input?.isTTY);

const notTty = () =>
  new InspectError('E_NOT_TTY', 'gates are answered only in your own terminal', {
    hint: 'run `shrine-inspect approve <run> <gate>` in an interactive terminal',
    exit: EXIT.GATE_WAITING,
  });

export async function prompt(question, { input = process.stdin, output = process.stderr } = {}) {
  if (!isTerminal(input)) throw notTty();
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

// Asks until accept(answer) returns a value, at most `attempts` times, on one
// readline so no typed line is lost between asks. Returns null when input ends
// (Ctrl-D) or no answer was accepted. Same terminal rule as prompt.
export async function askUntil(question, accept, { input = process.stdin, output = process.stderr, attempts = 3, again = (a) => a } = {}) {
  if (!isTerminal(input)) throw notTty();
  if (input.readableEnded || input.destroyed) {
    output.write(`${question}\n`);
    return null;
  }
  const rl = createInterface({ input, output });
  const queued = [];
  let waiting = null;
  let ended = false;
  rl.on('line', (l) => (waiting ? waiting(l.trim()) : queued.push(l.trim())));
  rl.once('close', () => {
    ended = true;
    if (waiting) waiting(null);
  });
  const next = () => (queued.length ? queued.shift() : ended ? null : new Promise((r) => (waiting = (v) => ((waiting = null), r(v)))));
  try {
    for (let i = 0; i < attempts; i++) {
      output.write(question);
      const answer = await next();
      if (answer === null) {
        output.write('\n');
        return null;
      }
      const v = accept(answer);
      if (v) return v;
      output.write(`${again(answer)}\n`);
    }
    return null;
  } finally {
    rl.close();
  }
}
