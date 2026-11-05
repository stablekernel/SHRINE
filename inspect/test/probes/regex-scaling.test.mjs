import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSegments } from '../../src/probes/command-position.mjs';
import { endsWithQuestion } from '../../src/episodes/extract.mjs';
import { classifyUser } from '../../src/adapters/claude-code/human-turn.mjs';
import { commitShas } from '../../src/adapters/claude-code/events.mjs';
import { sniffType } from '../../src/adapters/claude-code/stream.mjs';
import { isCorrectionCue, isDoneClaim } from '../../src/probes/usage.mjs';

// Every regex run on session, command, or tool text must be linear (or capped).
// Compares CPU time at 4x the input with 1x, best of 5 each, interleaved; the 1x
// input grows until one run takes at least 2ms. Linear gives about 4, quadratic 16.
function growth(build, fn) {
  const time = (s) => {
    const t = process.cpuUsage();
    fn(s);
    const d = process.cpuUsage(t);
    return (d.user + d.system) / 1000;
  };
  let n = 1000;
  while (time(build(n)) < 2 && n < 5_000_000) n *= 2;
  const small = build(n);
  const large = build(4 * n);
  let a = Infinity;
  let b = Infinity;
  for (let i = 0; i < 5; i++) {
    a = Math.min(a, time(small));
    b = Math.min(b, time(large));
  }
  // Still under 2ms at 5M chars: the function caps its input, so time is flat.
  return b < 2 ? 1 : b / a;
}

test('growth flags a quadratic regex', () => {
  assert.ok(growth((n) => 'x-'.repeat(n / 2), (s) => /(?:x-)+=/.test(s)) > 10);
});

const user = (text) => ({ message: { content: text } });
const CASES = [
  ['heredoc lines without a terminator', (n) => 'cat <<a\n'.repeat(n / 8), commandSegments],
  ['heredoc tag without a newline', (n) => `<<${'a'.repeat(n)}`, commandSegments],
  ['many heredoc starts without a newline', (n) => '<<a'.repeat(n / 3), commandSegments],
  ['open quote over escaped quotes', (n) => `"${'\\"'.repeat(n / 2)}`, commandSegments],
  ['open single quotes', (n) => `'"`.repeat(n / 2), commandSegments],
  ['wrapper chain', (n) => `${'do '.repeat(n / 3)}x`, commandSegments],
  ['env flags', (n) => `env${' -a'.repeat(n / 3)}`, commandSegments],
  ['question mark then spaces', (n) => `?${' '.repeat(n)}x`, endsWithQuestion],
  ['many question marks', (n) => '? '.repeat(n / 2), endsWithQuestion],
  ['open command-name', (n) => user(`<command-name>/${'a'.repeat(n)}`), classifyUser],
  ['command-name then spaces', (n) => user(`<command-name>${' '.repeat(n)}`), classifyUser],
  ['correction cue word run', (n) => `use ${'a'.repeat(n)}`, isCorrectionCue],
  ['done claim tail', (n) => 'is '.repeat(n / 3), isDoneClaim],
  ['commit sha line', (n) => `[${' a'.repeat(n / 2)}`, commitShas],
  ['sniff type', (n) => `{"type" ${' '.repeat(n)}`, sniffType],
];
for (const [name, build, fn] of CASES) {
  test(`linear on adversarial input: ${name}`, () => {
    const g = growth(build, fn);
    assert.ok(g < 10, `4x input took ${g.toFixed(1)}x the time`);
  });
}
