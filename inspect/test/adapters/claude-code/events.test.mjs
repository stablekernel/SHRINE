import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyUser } from '../../../src/adapters/claude-code/human-turn.mjs';
import { readSession } from '../../../src/adapters/claude-code/events.mjs';

const variants = JSON.parse(readFileSync(fileURLToPath(new URL('../../fixtures/sessions/human-turn/variants.json', import.meta.url)), 'utf8'));

for (const v of variants) {
  test(`human turn: ${v.name}`, () => {
    const r = classifyUser(v.line, { subagent: v.subagent === true });
    for (const [k, want] of Object.entries(v.expect)) assert.equal(r[k], want, `${k}`);
  });
}

const dir = mkdtempSync(join(tmpdir(), 'si-events-'));
const at = (min) => new Date(Date.parse('2026-11-01T10:00:00Z') + min * 60000).toISOString();
const base = (min) => ({ timestamp: at(min), sessionId: 's1', version: '2.1.318', cwd: '/w/app' });
const user = (min, content, extra = {}) => ({ type: 'user', ...base(min), uuid: `u${min}`, message: { role: 'user', content }, ...extra });
const asst = (min, req, content, usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 }) => ({ type: 'assistant', ...base(min), requestId: req, message: { role: 'assistant', model: 'claude-test-1', content, usage } });
const write = (p, lines) => writeFileSync(p, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

test('tokens once per requestId, cache_read apart; subagent tokens count, never human turns', async () => {
  const main = join(dir, 's1.jsonl');
  write(main, [
    user(0, 'build a parser', { promptSource: 'typed' }),
    asst(1, 'r1', [{ type: 'text', text: 'Starting.' }]),
    asst(1, 'r1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
    user(2, [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], { toolUseResult: { stdout: 'ok' } }),
    { type: 'system', subtype: 'compact_boundary', ...base(3) },
    user(3, 'summary', { isCompactSummary: true }),
    user(4, '[Request interrupted by user]'),
    asst(5, 'r2', [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/w/app/src/p.js', old_string: 'a', new_string: 'b' } }]),
  ]);
  mkdirSync(join(dir, 's1', 'subagents'), { recursive: true });
  const sub = join(dir, 's1', 'subagents', 'agent-x.jsonl');
  write(sub, [user(1.5, 'subtask prompt', { promptSource: 'typed', isSidechain: true }), asst(1.6, 'r3', [{ type: 'text', text: 'sub done' }], { input_tokens: 20, output_tokens: 10 })]);
  const { session, timeline } = await readSession({ id: 's1', path: main, project: 'app', subagent_files: [sub] });
  assert.equal(session.turns, 1);
  assert.deepEqual(session.tokens, { in: 12 + 12 + 20, out: 5 + 5 + 10, cache_read: 200 });
  assert.equal(session.subagent_share, Math.round((30 / 64) * 1000) / 1000);
  assert.equal(session.compactions, 1);
  assert.equal(session.interrupts, 1);
  assert.deepEqual(session.models, ['claude-test-1']);
  assert.equal(session.start, at(0));
  assert.equal(session.end, at(5));
  const kinds = timeline.map((e) => `${e.kind}${e.sub ? '*' : ''}`);
  assert.deepEqual(kinds, ['human', 'usage', 'assistant_text', 'tool_use', 'usage*', 'assistant_text*', 'tool_result', 'compact', 'interrupt', 'usage', 'tool_use']);
  assert.deepEqual(timeline.find((e) => e.name === 'Edit').files, ['/w/app/src/p.js']);
});

test('compaction count falls back to 0 when the marker is absent', async () => {
  const p = join(dir, 's2.jsonl');
  write(p, [user(0, 'hi', { promptSource: 'typed' }), asst(1, 'r1', [{ type: 'text', text: 'hello' }])]);
  const { session } = await readSession({ id: 's2', path: p, project: 'app' });
  assert.equal(session.compactions, 0);
});

test('secrets in prompts, replies, and commands are scrubbed before leaving the module', async () => {
  const p = join(dir, 's3.jsonl');
  const key = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-');
  write(p, [
    user(0, `use ${key} for the call`, { promptSource: 'typed' }),
    asst(1, 'r1', [{ type: 'text', text: `Set ANTHROPIC_API_KEY=${key}` }, { type: 'tool_use', id: 't', name: 'Bash', input: { command: `curl -H "x-api-key: ${key}" x` } }]),
  ]);
  const { timeline } = await readSession({ id: 's3', path: p, project: 'app' });
  assert.ok(!JSON.stringify(timeline).includes(key));
});

test('inline sidechain lines in the main file count tokens as subagent and are never human turns', async () => {
  const p = join(dir, 's4.jsonl');
  write(p, [user(0, 'main prompt', { promptSource: 'typed' }), user(1, 'inline subagent prompt', { isSidechain: true }), asst(2, 'rs', [{ type: 'text', text: 'x' }], { input_tokens: 10, output_tokens: 10 })].map((l, i) => (i === 2 ? { ...l, isSidechain: true } : l)));
  const { session } = await readSession({ id: 's4', path: p, project: 'app' });
  assert.equal(session.turns, 1);
  assert.equal(session.subagent_share, 1);
});

test('a split response keeps the largest usage per requestId', async () => {
  const p = join(dir, 's5.jsonl');
  write(p, [user(0, 'go', { promptSource: 'typed' }), asst(1, 'rq', [{ type: 'text', text: 'a' }], { input_tokens: 5, output_tokens: 1 }), asst(1, 'rq', [{ type: 'text', text: 'b' }], { input_tokens: 5, output_tokens: 40 })]);
  const { session, timeline } = await readSession({ id: 's5', path: p, project: 'app' });
  assert.deepEqual(session.tokens, { in: 5, out: 40, cache_read: 0 });
  assert.equal(timeline.find((e) => e.kind === 'usage').tokens, 45);
});
