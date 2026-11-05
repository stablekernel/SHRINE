// Resent messages and forked sessions are dropped before any count (reflect memo
// T0): a resend is the same text right after an unanswered or interrupted send; a
// fork's lines carry the uuid of the earlier session they were copied from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, resendKey } from '../../../src/adapters/claude-code/events.mjs';
import { extractEpisodes } from '../../../src/episodes/extract.mjs';

const dir = mkdtempSync(join(tmpdir(), 'si-dedupe-'));
const at = (min) => new Date(Date.parse('2026-11-01T10:00:00Z') + min * 60000).toISOString();
const base = (min, sid = 's1') => ({ timestamp: at(min), sessionId: sid, version: '2.1.318', cwd: '/w/app' });
const human = (min, text, uuid, sid) => ({ type: 'user', ...base(min, sid), uuid, promptSource: 'typed', turnOrigin: 'human', message: { role: 'user', content: text } });
const reply = (min, req, uuid, sid, extra = {}) => ({ type: 'assistant', ...base(min, sid), uuid, requestId: req, message: { role: 'assistant', model: 'claude-test-1', content: [{ type: 'text', text: 'Working on it.' }], usage: { input_tokens: 10, output_tokens: 5 } }, ...extra });
const interrupt = (min, uuid, sid) => ({ type: 'user', ...base(min, sid), uuid, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
const apiError = (min, uuid, sid) => ({ type: 'assistant', ...base(min, sid), uuid, isApiErrorMessage: true, message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: overloaded' }] } });
let n = 0;
const file = (lines) => {
  const p = join(dir, `f${++n}.jsonl`);
  writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return p;
};
const humans = (r) => r.timeline.filter((e) => e.kind === 'human').length;

test('resend key: same text up to whitespace, none for empty text', () => {
  assert.equal(resendKey('fix  the\nparser '), resendKey('fix the parser'));
  assert.notEqual(resendKey('fix the parser'), resendKey('fix the lexer'));
  assert.equal(resendKey('   '), null);
});

test('the same text sent again after an interrupt counts once', async () => {
  const r = await readSession({ id: 's1', path: file([human(0, 'Refactor the parser.', 'a1'), reply(1, 'r1', 'a2'), interrupt(2, 'a3'), human(3, 'Refactor  the parser.', 'a4'), reply(4, 'r2', 'a5')]), project: 'app' });
  assert.equal(r.session.turns, 1);
  assert.equal(humans(r), 1);
  assert.equal(r.dedupe.resent, 1);
});

test('the same text sent again with no answer, or after an API error, counts once', async () => {
  const unanswered = await readSession({ id: 's1', path: file([human(0, 'Run the tests.', 'b1'), human(1, 'Run the tests.', 'b2'), reply(2, 'r1', 'b3')]), project: 'app' });
  assert.equal(unanswered.session.turns, 1);
  const errored = await readSession({ id: 's1', path: file([human(0, 'Run the tests.', 'c1'), apiError(1, 'c2'), human(2, 'Run the tests.', 'c3'), reply(3, 'r1', 'c4')]), project: 'app' });
  assert.equal(errored.session.turns, 1);
  assert.equal(errored.dedupe.resent, 1);
});

test('a repeated message after a real answer is a new message; so is A, B, A', async () => {
  const again = await readSession({ id: 's1', path: file([human(0, 'continue', 'd1'), reply(1, 'r1', 'd2'), human(2, 'continue', 'd3'), reply(3, 'r2', 'd4')]), project: 'app' });
  assert.equal(again.session.turns, 2);
  assert.equal(again.dedupe.resent, 0);
  const aba = await readSession({ id: 's1', path: file([human(0, 'A task.', 'e1'), human(1, 'B task.', 'e2'), human(2, 'A task.', 'e3')]), project: 'app' });
  assert.equal(aba.session.turns, 3);
});

test('a resent correction is one correction candidate, not two', async () => {
  const r = await readSession({ id: 's1', path: file([human(0, 'Add a flag.', 'f1'), reply(1, 'r1', 'f2'), interrupt(2, 'f3'), human(3, 'No, wrong file, revert that.', 'f4'), interrupt(4, 'f5'), human(5, 'No, wrong file, revert that.', 'f6'), reply(6, 'r2', 'f7')]), project: 'app' });
  const [ep] = extractEpisodes(r.session, r.timeline);
  assert.equal(ep.flags.corrections, 1);
});

test('a forked session drops the lines copied from the earlier one: turns, tokens, and span count once', async () => {
  const seen = new Set();
  const prefix = [human(0, 'Plan the migration.', 'g1', 'orig'), reply(1, 'r1', 'g2', 'orig'), human(2, 'Use two steps.', 'g3', 'orig'), reply(3, 'r2', 'g4', 'orig')];
  const orig = await readSession({ id: 'orig', path: file(prefix), project: 'app' }, { seen });
  assert.equal(orig.session.turns, 2);
  assert.equal(orig.dedupe.copied_lines, 0);
  const fork = await readSession({ id: 'fork', path: file([...prefix, human(60, 'Now write step one.', 'h1', 'fork'), reply(61, 'r9', 'h2', 'fork')]), project: 'app' }, { seen });
  assert.equal(fork.session.turns, 1);
  assert.equal(fork.dedupe.copied_lines, 4);
  assert.equal(fork.dedupe.copied_messages, 2);
  assert.equal(fork.dedupe.only_copies, false);
  assert.deepEqual(fork.session.tokens, { in: 10, out: 5, cache_read: 0 });
  assert.equal(fork.session.start, at(60));
  const pure = await readSession({ id: 'copy', path: file(prefix), project: 'app' }, { seen });
  assert.equal(pure.dedupe.only_copies, true);
  assert.equal(pure.session.turns, 0);
});

test('a uuid repeated inside one session is not a copy; without a shared set nothing is dropped', async () => {
  const seen = new Set();
  const r = await readSession({ id: 's1', path: file([human(0, 'One.', 'k1'), reply(1, 'r1', 'k2'), human(2, 'Two.', 'k1')]), project: 'app' }, { seen });
  assert.equal(r.session.turns, 2);
  assert.equal(r.dedupe.copied_lines, 0);
  const alone = await readSession({ id: 's2', path: file([human(0, 'One.', 'k1')]), project: 'app' });
  assert.equal(alone.session.turns, 1);
});

// Known limits (README "Counting"): pinned so a change is deliberate.
test('known limit: the same prompt in a new, unforked session counts again', async () => {
  const seen = new Set();
  const a = await readSession({ id: 'a', path: file([human(0, 'Rename the module.', 'm1', 'a')]), project: 'app' }, { seen });
  const b = await readSession({ id: 'b', path: file([human(5, 'Rename the module.', 'm2', 'b')]), project: 'app' }, { seen });
  assert.equal(a.session.turns + b.session.turns, 2);
});

test('known limit: the file read first keeps the shared lines; the later file is counted as the fork', async () => {
  const seen = new Set();
  const prefix = [human(0, 'Plan it.', 'n1', 'x'), reply(1, 'r1', 'n2', 'x')];
  const fork = await readSession({ id: 'fork', path: file([...prefix, human(9, 'Step one.', 'n3', 'fork')]), project: 'app' }, { seen });
  const orig = await readSession({ id: 'orig', path: file([...prefix, human(5, 'Step zero.', 'n4', 'x')]), project: 'app' }, { seen });
  assert.equal(fork.dedupe.copied_lines, 0);
  assert.equal(orig.dedupe.copied_lines, 2);
  assert.equal(fork.session.turns + orig.session.turns, 3, 'each message still counts once');
});

test('a resend right after a resume counts once: copied lines set the resend state', async () => {
  const seen = new Set();
  const prefix = [human(0, 'Deploy to staging.', 'p1', 'o'), interrupt(1, 'p2', 'o')];
  await readSession({ id: 'o', path: file(prefix), project: 'app' }, { seen });
  const resumed = await readSession({ id: 'r', path: file([...prefix, human(9, 'Deploy to staging.', 'p3', 'r'), reply(10, 'r1', 'p4', 'r')]), project: 'app' }, { seen });
  assert.equal(resumed.session.turns, 0);
  assert.equal(resumed.dedupe.resent, 1);
});

test('a command or a compaction between two same texts makes the second a new message', async () => {
  const clear = { type: 'user', ...base(2), uuid: 'q3', message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' } };
  const r = await readSession({ id: 's1', path: file([human(0, 'continue', 'q1'), interrupt(1, 'q2'), clear, human(3, 'continue', 'q4')]), project: 'app' });
  assert.equal(r.session.turns, 2);
  const compact = { type: 'system', subtype: 'compact_boundary', ...base(2), uuid: 'v3' };
  const c = await readSession({ id: 's1', path: file([human(0, 'continue', 'v1'), human(1, 'continue', 'v2'), compact, human(3, 'continue', 'v4')]), project: 'app' });
  assert.equal(c.session.turns, 2, 'the unanswered second send is a resend; after the compaction it is new');
});

test('known limit: copies of a session that was not read (outside the window) count as the fork\'s own lines', async () => {
  const seen = new Set();
  const r = await readSession({ id: 'fork', path: file([human(0, 'Old plan.', 'w1', 'gone'), reply(1, 'r1', 'w2', 'gone'), human(9, 'New step.', 'w3', 'fork')]), project: 'app' }, { seen });
  assert.equal(r.session.turns, 2);
  assert.equal(r.dedupe.copied_lines, 0);
});
