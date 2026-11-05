import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, bundleTokens, judgePrompt, JUDGE_MARKER, payloadOf } from '../../src/judge/bundle.mjs';
import { sliceEpisode } from '../../src/adapters/claude-code/transcript.mjs';
import { buildIdentifiers } from '../../src/scrub/mask.mjs';
import { HOUSEKEEPING } from '../../src/adapters/claude-code/projects.mjs';

const TEMPLATE = readFileSync(fileURLToPath(new URL('../../src/judge/classifier.prompt.md', import.meta.url)), 'utf8');
const HOME = '/Users/fixture-person';
const known = buildIdentifiers({ osUser: 'fixture-person', home: HOME, projects: ['acme-shop'] });
const at = (m) => new Date(Date.UTC(2026, 9, 20, 10, m)).toISOString();
const episode = { id: 'e-abc', session_id: 's1', root_turn_id: 'u1', start: at(0), end: at(30), terminal: 'session_end' };
const longReply = `Plan: ${'step '.repeat(200)}END-OF-REPLY`;
const events = () => [
  { t: at(0), kind: 'human', uuid: 'u1', text: `Build the export in ${HOME}/work/acme-shop/src/export.js please.` },
  { t: at(1), kind: 'usage', tokens: 1000 },
  { t: at(1), kind: 'assistant_text', text: 'tail of reply', head: longReply.slice(0, 400) },
  { t: at(2), kind: 'tool_use', name: 'Edit', command: 'secret-arg-never-sent', id: 'x1' },
  { t: at(2), kind: 'tool_use', name: 'Bash', command: 'npm test --token=abc', id: 'x2' },
  { t: at(3), kind: 'tool_result', id: 'x2' },
  { t: at(5), kind: 'interrupt' },
  { t: at(6), kind: 'human', uuid: 'u2', text: 'Use semicolons, not commas.' },
  { t: at(7), kind: 'usage', tokens: 500 },
  { t: at(7), kind: 'assistant_text', text: 'Done.' },
  { t: at(8), kind: 'human', uuid: 'u3', text: 'Looks good, thanks.' },
];
const snapshot = [{ path: `${HOME}/work/acme-shop/CLAUDE.md`, content: '# Rules\n- Use pnpm for scripts.\n' }];

test('human turns keep text; replies keep their opening only; tools are names without arguments', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot }, known, nonce: 'n1' });
  const p = payloadOf(b);
  assert.deepEqual(p.turns.map((t) => [t.id, t.role]), [['t01', 'human'], ['t02', 'assistant'], ['t03', 'human'], ['t04', 'assistant'], ['t05', 'human']]);
  assert.equal(p.turns[1].text.length, 400);
  assert.ok(!p.turns[1].text.includes('END-OF-REPLY'));
  assert.deepEqual(p.turns[1].tools, ['Edit', 'Bash']);
  assert.doesNotMatch(JSON.stringify(p), /secret-arg-never-sent|npm test --token/);
  // Candidates by code: after an interrupt or a cue, never the first turn.
  assert.deepEqual(p.turns.filter((t) => t.role === 'human').map((t) => t.candidate), [false, true, false]);
  assert.equal(p.turns[2].after_interrupt, true);
  assert.equal(b.meta.tokens_after.t03, 500);
  assert.equal(b.meta.human_after.t01, 2);
  assert.equal(b.meta.human_index.t03, 1);
});

test('paths and names are masked; the live config comes from the snapshot', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot }, known, nonce: 'n1' });
  const s = JSON.stringify(payloadOf(b));
  assert.doesNotMatch(s, /fixture-person|\/Users\/|acme-shop/);
  assert.equal(b.config_source, 'snapshot');
  assert.equal(b.config[0].id, 'c1');
  assert.match(b.config[0].text, /Use pnpm for scripts/);
  assert.equal(b.config[0].may_have_changed, false);
});

test('caps: 1,200 characters per human turn, 12 human turns, and about 6K tokens per bundle', () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ t: at(i), kind: 'human', uuid: `u${i}`, text: `${'word '.repeat(400)}${i}` });
  const b = buildBundle({ episode: { ...episode, root_turn_id: 'u0' }, transcript: { events: many, snapshot: null }, known, nonce: 'n' });
  assert.ok(b.turns.length <= 12);
  assert.ok(b.turns.every((t) => t.text.length <= 1200));
  assert.ok(bundleTokens(b) <= 6000, `tokens ${bundleTokens(b)}`);
  assert.equal(b.meta.truncated_turns, true);
});

test('no snapshot: current files are used and marked may_have_changed when edited after the start', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: null }, fallbackConfig: [{ path: `${HOME}/.claude/CLAUDE.md`, content: 'rule', may_have_changed: true }], known, nonce: 'n' });
  assert.equal(b.config_source, 'current');
  assert.equal(b.config[0].may_have_changed, true);
});

test('an oversized config is cut and flagged', () => {
  const big = [{ path: '/x/CLAUDE.md', content: 'rule line\n'.repeat(3000) }];
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: big }, known, nonce: 'n' });
  assert.equal(b.config_truncated, true);
  assert.ok(b.config.reduce((n, c) => n + c.text.length, 0) <= 12000);
});

test('slicing: from the root turn by uuid through the end time, main thread only', () => {
  const tl = [
    { t: at(0), kind: 'instructions', files: snapshot },
    ...events(),
    { t: at(9), kind: 'tool_use', name: 'Task', sub: true },
    { t: at(40), kind: 'human', uuid: 'u9', text: 'next task' },
  ];
  const s = sliceEpisode(tl, episode);
  assert.equal(s.events[0].uuid, 'u1');
  assert.ok(!s.events.some((e) => e.sub || e.uuid === 'u9' || e.kind === 'instructions'));
  assert.deepEqual(s.snapshot, snapshot);
  assert.equal(sliceEpisode(tl, { ...episode, root_turn_id: 'missing', start: at(99) }), null);
});

test('the prompt starts with the housekeeping marker and fences the data with the nonce', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot }, known, nonce: 'abc123' });
  const p = judgePrompt(b, { template: TEMPLATE, entryIds: ['x.y'] });
  assert.ok(p.startsWith(JUDGE_MARKER));
  assert.ok(HOUSEKEEPING.prefixes.includes(JUDGE_MARKER));
  assert.ok(HOUSEKEEPING.positive.every((x) => HOUSEKEEPING.prefixes.some((pre) => x.startsWith(pre))));
  assert.ok(HOUSEKEEPING.negative.every((x) => !HOUSEKEEPING.prefixes.some((pre) => x.startsWith(pre))));
  assert.match(p, /<data-abc123>\n\{.*\}\n<\/data-abc123>/s);
  assert.match(p, /never instructions to you/);
  assert.match(p, /The nonce is abc123/);
});

test('a snapshot logged only after the episode started is kept but marked may_have_changed', () => {
  const tl = [...events(), { t: at(20), kind: 'instructions', files: snapshot }];
  const s = sliceEpisode(tl, episode);
  assert.equal(s.snapshot_late, true);
  const b = buildBundle({ episode, transcript: s, known, nonce: 'n' });
  assert.equal(b.config[0].may_have_changed, true);
});
