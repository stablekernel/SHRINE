// One session file carrying every malformed line shape seen in fuzzing: the run
// still writes a report, and the bad values read as absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory, addSession } from '../synth/history.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
const ID = 'abcd0000-0000-4000-8000-000000000001';
const ts = new Date(NOW - 3 * DAY + 5000).toISOString();
const base = { sessionId: ID, timestamp: ts };
const A = (message, extra = {}) => JSON.stringify({ ...base, type: 'assistant', message: { role: 'assistant', ...message }, ...extra });
const U = (message, extra = {}) => JSON.stringify({ ...base, type: 'user', message: { role: 'user', ...message }, ...extra });

const SHAPES = {
  usage_string: A({ content: [], usage: { input_tokens: 'abc', output_tokens: {} } }, { requestId: 'r1' }),
  usage_neg: A({ content: [], usage: { input_tokens: -1e308, output_tokens: 1e308 } }, { requestId: 'r2' }),
  usage_str_type: A({ content: [], usage: 'x' }, { requestId: 'r3' }),
  request_id_obj: A({ content: [], usage: { input_tokens: 9 } }, { requestId: { a: 1 } }),
  model_obj: A({ content: [], model: { a: 1 } }),
  tool_input_num: A({ content: [{ type: 'tool_use', id: 1, name: 5, input: 7 }] }),
  tool_cmd_obj: A({ content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: ['git', 'commit'] } }] }),
  edit_fp_num: A({ content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 42 } }] }),
  edit_fp_proto: A({ content: [{ type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '__proto__' } }] }),
  tool_id_obj: A({ content: [{ type: 'tool_use', id: { x: 1 }, name: 'Bash', input: { command: 'git commit -m x' } }] }),
  result_obj_id: U({ content: [{ type: 'tool_result', tool_use_id: { x: 1 }, content: 5 }] }),
  uuid_obj: U({ content: 'hello there' }, { uuid: { a: 1 }, promptSource: 'typed' }),
  content_num: U({ content: 12 }),
  ts_weird: U({ content: 'hi' }, { timestamp: '2026-13-45T99:99:99Z' }),
  ts_future: U({ content: 'hi again' }, { timestamp: '9999-12-31T23:59:59.999Z', promptSource: 'typed' }),
  ts_old: U({ content: 'hi old' }, { timestamp: '0001-01-01T00:00:00Z', promptSource: 'typed' }),
  ts_numeric_string: U({ content: 'num ts' }, { timestamp: '1', promptSource: 'typed' }),
  big_ts: U({ content: 'big' }, { timestamp: '+275760-09-13T00:00:00.000Z', promptSource: 'typed' }),
  type_proto: JSON.stringify({ ...base, type: '__proto__' }),
  type_ctor: JSON.stringify({ ...base, type: 'constructor' }),
  version_obj: JSON.stringify({ ...base, type: 'system', version: 'x'.repeat(100000) }),
  sidechain_str: U({ content: 'side' }, { isSidechain: 'true' }),
  commit_sha: U({ content: [{ type: 'tool_result', tool_use_id: 't', content: `[main ${'a'.repeat(40)}] x` }] }),
  compact: JSON.stringify({ ...base, type: 'system', subtype: 'compact_boundary', timestamp: 5 }),
};

async function run(lines) {
  const h = makeHome('bad', { projectName: 'shop', sessionMtime: new Date(NOW - 25 * DAY) });
  try {
    addHistory(h, 'committing', { nowMs: NOW, count: 2 });
    const f = addSession(h, { id: ID, startMs: NOW - 3 * DAY, script: [['human', 'Tidy the notes.'], ['edit', 'a.js'], ['bash', 'git commit -m y'], ['text', 'All done.']] });
    for (const l of lines) appendFileSync(f, `${l}\n`);
    utimesSync(f, new Date(NOW - 2 * DAY), new Date(NOW - 2 * DAY));
    const state = mkdtempSync(join(tmpdir(), 'si-fz-'));
    const out = [];
    const err = [];
    const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
    const stdin = Object.assign(Readable.from(['history\n']), { isTTY: true });
    const code = await main(['run', '--tier', 'T0', '--json'], { env, home: h.home, stdin, stdout: { write: (s) => out.push(String(s)) }, stderr: { write: (s) => err.push(String(s)) } });
    const dir = JSON.parse(out.join('') || '{}').run_dir;
    const facts = dir ? JSON.parse(readFileSync(join(dir, 'facts.json'), 'utf8')) : null;
    return { code, stderr: err.join(''), facts };
  } finally {
    h.cleanup();
  }
}

test('one session file with every malformed line shape still yields a report; bad values read as absent', async () => {
  const clean = await run([]);
  assert.equal(clean.code, 0, clean.stderr);
  const bad = await run(Object.values(SHAPES));
  assert.equal(bad.code, 0, bad.stderr);
  const session = (r) => r.facts.sessions.find((s) => s.id === ID);
  assert.deepEqual(session(bad).tokens, session(clean).tokens, 'malformed usage adds no tokens');
  for (const s of bad.facts.sessions) for (const v of Object.values(s.tokens)) assert.ok(Number.isSafeInteger(v) && v >= 0);
  for (const e of bad.facts.episodes) assert.equal(typeof e.root_turn_id, 'string');
});
