import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSegments } from '../../src/probes/command-position.mjs';
import { endsWithQuestion } from '../../src/episodes/extract.mjs';
import { classifyUser } from '../../src/adapters/claude-code/human-turn.mjs';
import { commitShas } from '../../src/adapters/claude-code/events.mjs';
import { sniffType } from '../../src/adapters/claude-code/stream.mjs';
import { isCorrectionCue, isDoneClaim } from '../../src/probes/usage.mjs';
import { growth } from '../synth/growth.mjs';

// Every regex run on session, command, or tool text must be linear (or capped).
// The shared growth helper compares CPU time at 4x the input with 1x; linear gives
// about 4, quadratic about 16. The tripwire uses the hardened options.
test('growth flags a quadratic regex', () => {
  assert.ok(growth((n) => 'x-'.repeat(n / 2), (s) => /(?:x-)+=/.test(s), { minMs: 8, tries: 7 }) >= 10);
});

const user = (text) => ({ message: { content: text } });
const CASES = [
  ['heredoc lines without a terminator', (n) => 'cat <<a\n'.repeat(n / 8), commandSegments],
  ['heredoc tag without a newline', (n) => `<<${'a'.repeat(n)}`, commandSegments],
  ['many heredoc starts without a newline', (n) => '<<a'.repeat(n / 3), commandSegments],
  ['many distinct unclosed heredocs', (n) => Array.from({ length: n / 10 }, (_, k) => `c <<t${k}\n`).join(''), commandSegments],
  ['one unclosed tag, many lines starting with it', (n) => `c <<ab\n${'abc\n<<ab\n'.repeat(n / 9)}`, commandSegments],
  ['many closed heredocs', (n) => 'c <<a\nx\na\n'.repeat(n / 10), commandSegments],
  ['here-strings', (n) => '<<<'.repeat(n / 3), commandSegments],
  ['shifts in arithmetic', (n) => `$((${'1<<a\n'.repeat(n / 5)}`, commandSegments],
  ['unclosed arithmetic', (n) => '(('.repeat(n / 2), commandSegments],
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
