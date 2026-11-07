// `run` with no --tier asks for one in an interactive terminal, and only there.
// Anywhere else (piped stdin, `start`, a skill) it stops with a usage error that
// names the flag: never a silent default, never a hang. Picking T1 here is not
// Gate B consent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main, parseArgs } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));

function sink() {
  const chunks = [];
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join('') };
}
// A terminal that types these lines, then ends (Ctrl-D).
function tty(...lines) {
  const s = Readable.from(lines.map((l) => `${l}\n`));
  s.isTTY = true;
  return s;
}
function setup() {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const env = { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: JSON.stringify(['^/nowhere/']), HOME: h.home };
  return { h, state, env };
}
async function inproc(argv, { h, env }, stdin) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env, home: h.home, stdin, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
const runs = (state) => (existsSync(join(state, 'state', 'runs')) ? readdirSync(join(state, 'state', 'runs')) : []);
const stateOf = (state) => JSON.parse(readFileSync(join(state, 'state', 'runs', runs(state)[0], 'state.json'), 'utf8'));

test('run with no --tier and no terminal: usage error naming --tier, no run created', async () => {
  const s = setup();
  const r = await inproc(['run', '--json'], s, { isTTY: false });
  assert.equal(r.code, 2);
  const err = JSON.parse(r.stderr).error;
  assert.equal(err.code, 'E_TIER_REQUIRED');
  assert.match(`${err.message} ${err.hint}`, /--tier T0\|T1/);
  assert.deepEqual(runs(s.state), []);
  s.h.cleanup();
});

test('start with no --tier is refused even in a terminal: no worker, no run', async () => {
  const s = setup();
  const r = await inproc(['start'], s, tty('T0'));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--tier T0\|T1/);
  assert.doesNotMatch(r.stderr, /Pick a tier/);
  assert.deepEqual(runs(s.state), []);
  s.h.cleanup();
});

test('piped stdin to the bin is refused at once, never read as a tier', () => {
  const s = setup();
  const r = spawnSync(process.execPath, [BIN, 'run', '--no-history'], { env: s.env, input: 'T0\n', encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--tier T0\|T1/);
  assert.deepEqual(runs(s.state), []);
  s.h.cleanup();
});

test('terminal: the menu names both tiers; t0 (any case) runs the scan only', async () => {
  const s = setup();
  const r = await inproc(['run', '--no-history', '--json'], s, tty('t0'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /T0: scan only/);
  assert.match(r.stderr, /T1: /);
  assert.match(r.stderr, /Gate B/);
  const st = stateOf(s.state);
  assert.equal(st.tier, 'T0');
  assert.equal(st.gates.B.choice, 'T0');
  assert.equal(st.gates.B.by, 'prompt');
  s.h.cleanup();
});

test('terminal: a wrong answer asks again; T1 is not Gate B consent', async () => {
  const s = setup();
  // T1, then the Gate A question gets no answer (input ends): the run pauses.
  const r = await inproc(['run'], s, tty('T2', 'T1'));
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /not T2|T0 or T1/);
  assert.equal((r.stderr.match(/Type T0 or T1/g) ?? []).length, 2);
  const st = stateOf(s.state);
  assert.equal(st.tier, 'T1');
  assert.equal(st.gates.B, null);
  s.h.cleanup();
});

test('terminal: three wrong or empty answers stop with no run created', async () => {
  const s = setup();
  const r = await inproc(['run', '--json'], s, tty('', 'yes', 'T2', 'T1'));
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr.trim().split('\n').at(-1)).error.code, 'E_TIER_NOT_CHOSEN');
  assert.deepEqual(runs(s.state), []);
  s.h.cleanup();
});

test('terminal: input that ends (Ctrl-D) stops at once with no run created', async () => {
  const s = setup();
  const r = await inproc(['run'], s, tty());
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no tier chosen/);
  assert.equal((r.stderr.match(/Type T0 or T1/g) ?? []).length, 1);
  assert.deepEqual(runs(s.state), []);
  s.h.cleanup();
});

test('--tier with no value is a usage error, not a prompt', () => {
  assert.throws(() => parseArgs(['run', '--tier']), (e) => e.code === 'E_USAGE');
  assert.throws(() => parseArgs(['run', '--tier', '--json']), (e) => e.code === 'E_USAGE');
});
