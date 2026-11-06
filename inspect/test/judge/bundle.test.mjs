import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle, bundleTokens, DEFAULT_CAPS, judgePrompt, JUDGE_MARKER, payloadOf } from '../../src/judge/bundle.mjs';
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

test('human turns keep text; replies keep their opening; tools are names without arguments', () => {
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
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: [{ path: snapshot[0].path, content: '# Style\n- Use semicolons in CSV output.\n- Use pnpm for scripts.\n' }] }, known, nonce: 'n1' });
  const s = JSON.stringify(payloadOf(b));
  assert.doesNotMatch(s, /fixture-person|\/Users\/|acme-shop/);
  assert.equal(b.config_source, 'snapshot');
  assert.equal(b.config[0].id, 'c1');
  assert.equal(b.config_may_have_changed, false);
});

test('config: code searches every file and sends only the lines that match a flagged turn, under their heading', () => {
  const files = [
    { path: `${HOME}/.claude/CLAUDE.md`, content: `# Intro\n${'- Keep the build green.\n'.repeat(400)}` },
    { path: `${HOME}/work/acme-shop/CLAUDE.md`, content: '# Output style\n- Use semicolons in CSV output.\n- Use pnpm for scripts.\n' },
  ];
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: files }, known, nonce: 'n' });
  const p = payloadOf(b);
  assert.equal(p.config_searched, true);
  assert.equal(p.config.length, 1, 'the first file holds nothing that matches');
  assert.equal(p.config[0].text, '# Output style\n- Use semicolons in CSV output.');
  assert.deepEqual(b.meta.config_lines.t03, { matched: 1, best: 1, sent: 1 });
  assert.equal(b.config_truncated, false);
});

test('config: each flagged turn gets its best lines; one turn with many matches cannot crowd out another', () => {
  const ev = [
    { t: at(0), kind: 'human', uuid: 'u1', text: 'Build the export.' },
    { t: at(1), kind: 'assistant_text', text: 'ok' },
    { t: at(2), kind: 'interrupt' },
    { t: at(3), kind: 'human', uuid: 'u2', text: 'Stop, the migration scripts need a dry run first.' },
    { t: at(4), kind: 'assistant_text', text: 'ok' },
    { t: at(5), kind: 'interrupt' },
    { t: at(6), kind: 'human', uuid: 'u3', text: 'Wait, keep semicolons as the CSV separator.' },
  ];
  const noise = Array.from({ length: 20 }, (_, i) => `- Rule ${i}: every migration script runs a dry run before apply, ${'with a long explanation '.repeat(4)}`).join('\n');
  const files = [{ path: '/r/CLAUDE.md', content: `# Data\n${noise}\n# Output\n- Use semicolons as the CSV separator.\n${'- Unrelated filler line here.\n'.repeat(80)}` }];
  const b = buildBundle({ episode, transcript: { events: ev, snapshot: files }, known, nonce: 'n' });
  assert.ok(b.meta.config_lines.t03.matched > b.meta.config_lines.t03.best, 'more matches than are sent');
  assert.equal(b.meta.config_lines.t03.sent, b.meta.config_lines.t03.best);
  assert.deepEqual(b.meta.config_lines.t05, { matched: 1, best: 1, sent: 1 });
  assert.match(b.config.map((c) => c.text).join('\n'), /Use semicolons as the CSV separator/);
});

test('config: no line matches, so config is empty and the search still counts', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot }, known, nonce: 'n' });
  assert.equal(payloadOf(b).config_searched, true);
  assert.deepEqual(b.config, []);
  assert.deepEqual(b.meta.config_lines.t03, { matched: 0, best: 0, sent: 0 });
});

test('config: a file the reader had to cut means the search was not over the whole config', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: [{ ...snapshot[0], cut: true }] }, known, nonce: 'n' });
  assert.equal(b.config_searched, false);
  assert.equal(b.config_truncated, true);
});

test('caps: 1,200 characters per human turn, 12 human turns kept first and last, and the bundle token cap', () => {
  const many = [];
  for (let i = 0; i < 20; i++) many.push({ t: at(i), kind: 'human', uuid: `u${i}`, text: `${'word '.repeat(400)}${i}` });
  const b = buildBundle({ episode: { ...episode, root_turn_id: 'u0' }, transcript: { events: many, snapshot: null }, known, nonce: 'n' });
  assert.ok(b.turns.length <= 12);
  assert.ok(b.turns.every((t) => t.text.length <= 1200));
  assert.ok(bundleTokens(b) <= DEFAULT_CAPS.bundle_tokens, `tokens ${bundleTokens(b)}`);
  assert.equal(b.meta.truncated_turns, true);
  assert.equal(b.turns[0].id, 't01', 'the root prompt stays');
  assert.equal(b.turns.at(-1).id, 't20', 'the last turn stays');
  assert.equal(payloadOf(b).omitted_turns, 20 - b.turns.length);
});

test('trimming drops middle turns that are not flagged before flagged ones', () => {
  const ev = [];
  for (let i = 0; i < 10; i++) {
    ev.push({ t: at(i), kind: 'human', uuid: `u${i}`, text: i === 5 ? `Actually, use tabs ${'x '.repeat(200)}` : `next step ${'word '.repeat(220)}${i}` });
    ev.push({ t: at(i), kind: 'assistant_text', text: 'ok', head: 'reply '.repeat(60) });
  }
  const b = buildBundle({ episode: { ...episode, root_turn_id: 'u0' }, transcript: { events: ev, snapshot: null }, known, nonce: 'n' });
  assert.ok(bundleTokens(b) <= DEFAULT_CAPS.bundle_tokens);
  assert.ok(b.omitted_turns > 0);
  assert.ok(b.turns.some((t) => t.candidate), 'the flagged turn stays');
  assert.equal(b.turns[0].id, 't01');
  assert.equal(b.turns.at(-1).id, 't20');
});

test('the end signal and the closing of the last reply reach the judge', () => {
  const ev = [...events(), { t: at(9), kind: 'assistant_text', text: `${'filler '.repeat(80)}All tests pass and the change is committed.`, head: 'Starting on it.' }];
  const b = buildBundle({ episode: { ...episode, terminal: 'commit' }, transcript: { events: ev, snapshot }, known, nonce: 'n' });
  const p = payloadOf(b);
  assert.equal(p.episode_end, 'commit');
  const last = p.turns.at(-1);
  assert.equal(last.role, 'assistant');
  assert.ok(last.closing.endsWith('All tests pass and the change is committed.'));
  assert.ok(last.closing.length <= DEFAULT_CAPS.closing_chars);
  assert.equal(p.turns[1].closing, undefined, 'only the last reply carries a closing');
});

test('cap holds in the worst case: long turns, long replies, many tools, and a large config', () => {
  const ev = [];
  for (let i = 0; i < 20; i++) {
    ev.push({ t: at(i), kind: 'human', uuid: `u${i}`, text: `Actually rule other ${'word '.repeat(400)}${i}` });
    ev.push({ t: at(i), kind: 'assistant_text', text: 'closing '.repeat(100), head: 'reply '.repeat(100) });
    for (let k = 0; k < 12; k++) ev.push({ t: at(i), kind: 'tool_use', name: `Tool${k}${'n'.repeat(60)}`, id: `x${i}-${k}` });
  }
  const big = [{ path: `${HOME}/a/CLAUDE.md`, content: Array.from({ length: 3000 }, (_, i) => `rule line ${i} word`).join('\n') }, { path: `${HOME}/b/CLAUDE.md`, content: 'other rule word\n'.repeat(3000) }];
  const b = buildBundle({ episode: { ...episode, root_turn_id: 'u0' }, transcript: { events: ev, snapshot: big }, known, nonce: 'n' });
  assert.ok(bundleTokens(b) <= DEFAULT_CAPS.bundle_tokens, `tokens ${bundleTokens(b)}`);
  assert.ok(b.turns.filter((t) => t.role === 'human').length >= 1);
  assert.equal(b.turns[0].id, 't01');
});

test('no snapshot: current files are used and marked may_have_changed when edited after the start', () => {
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: null }, fallbackConfig: [{ path: `${HOME}/.claude/CLAUDE.md`, content: '- Use semicolons in CSV output.', may_have_changed: true }], known, nonce: 'n' });
  assert.equal(b.config_source, 'current');
  assert.equal(b.config_may_have_changed, true);
  assert.equal(b.config[0].may_have_changed, true);
});

test('a large config is searched in full; the excerpt stays within its cap', () => {
  const big = [{ path: '/x/CLAUDE.md', content: `${'rule line\n'.repeat(3000)}- Use semicolons in CSV output.\n` }];
  const b = buildBundle({ episode, transcript: { events: events(), snapshot: big }, known, nonce: 'n' });
  assert.equal(b.config_truncated, false);
  assert.equal(b.config_searched, true);
  assert.match(b.config[0].text, /semicolons/);
  assert.ok(b.config.reduce((n, c) => n + c.text.length, 0) <= DEFAULT_CAPS.config_excerpt_chars);
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
  assert.equal(b.config_may_have_changed, true);
});
