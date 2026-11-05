import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { diffRuns } from '../../src/diff/previous.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));
const TEMP = JSON.stringify(['^/nowhere/']);

function sink() {
  const chunks = [];
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join('') };
}
function tty(answer) {
  const s = Readable.from([`${answer}\n`]);
  s.isTTY = true;
  return s;
}
function env(h, state) {
  return { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: TEMP, HOME: h.home };
}
async function inproc(argv, h, state, stdin = { isTTY: false }) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env: env(h, state), home: h.home, stdin, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
const runsOf = (state) => readdirSync(join(state, 'state', 'runs')).sort();

test('run --tier T0 --no-history writes every output and .done marker', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  for (const f of ['facts.json', 'scan.json', 'findings.json', 'report.html', 'report.share-safe.html', 'scan.done', 'facts.done', 'findings.done', 'report.done']) {
    assert.ok(existsSync(join(s.run_dir, f)), f);
  }
  const facts = JSON.parse(readFileSync(join(s.run_dir, 'facts.json'), 'utf8'));
  assert.equal(facts.run.scope.history_consented, false);
  assert.deepEqual(facts.sessions, []);
  assert.equal(s.diff, null, 'no diff on a first run');
  h.cleanup();
});

test('an unanswered gate pauses the run with exit 3 and no default answer', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /paused at Gate A/);
  const dir = join(state, 'state', 'runs', runsOf(state)[0]);
  assert.ok(existsSync(join(dir, 'gate.json')));
  assert.ok(!existsSync(join(dir, 'findings.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).gates.A, null);
  h.cleanup();
});

test('approve in a TTY resumes a paused run', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  await inproc(['run', '--tier', 'T0'], h, state);
  const id = runsOf(state)[0];
  const r = await inproc(['approve', id, 'A', 'no-history'], h, state, tty('yes'));
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(state, 'state', 'runs', id, 'report.html')));
  const st = JSON.parse(readFileSync(join(state, 'state', 'runs', id, 'state.json'), 'utf8'));
  assert.equal(st.gates.A.choice, 'no-history');
  assert.equal(st.gates.A.by, 'tty');
  h.cleanup();
});

test('run in a TTY prompts inline through the approve code path', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state, tty('no-history'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Gate A: Read session history too\?/);
  h.cleanup();
});

test('a TTY answer that is not a choice leaves the run paused', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state, tty(''));
  assert.equal(r.code, 3);
  h.cleanup();
});

test('approve on piped stdin exits 3 with E_NOT_TTY, JSON error on stderr', () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = spawnSync(process.execPath, [BIN, 'approve', 'any-run', 'A', 'history', '--json'], { env: env(h, state), input: 'yes\n', encoding: 'utf8' });
  assert.equal(r.status, 3);
  const err = JSON.parse(r.stderr).error;
  assert.equal(err.code, 'E_NOT_TTY');
  assert.ok(err.message && err.hint);
  h.cleanup();
});

test('exit codes: usage 2 for unknown command, option, or tier', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  assert.equal((await inproc(['nope'], h, state)).code, 2);
  assert.equal((await inproc(['run', '--bogus'], h, state)).code, 2);
  const t1 = await inproc(['run', '--tier', 'T1', '--json'], h, state);
  assert.equal(t1.code, 2);
  assert.equal(JSON.parse(t1.stderr).error.code, 'E_TIER');
  h.cleanup();
});

test('bin runs end to end as a child process', () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = spawnSync(process.execPath, [BIN, 'run', '--tier', 'T0', '--no-history'], { env: env(h, state), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Report: .*report\.html/);
  h.cleanup();
});

test('diff prints new, cleared, unchanged against the previous run, nothing on the first', async () => {
  const h = makeHome('bad');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const first = await inproc(['run', '--tier', 'T0', '--no-history'], h, state);
  assert.ok(!/new \d+, cleared/.test(first.stdout));
  // Apply the retention pivot, then run again: that finding clears.
  const settings = join(h.claudeHome, 'settings.json');
  const s = JSON.parse(readFileSync(settings, 'utf8'));
  writeFileSync(settings, JSON.stringify({ ...s, cleanupPeriodDays: 90 }));
  const second = await inproc(['run', '--tier', 'T0', '--no-history'], h, state);
  assert.match(second.stdout, /^new 0, cleared 1, unchanged \d+$/m);
  h.cleanup();
});

test('diffRuns counts ids', () => {
  const f = (...ids) => ({ findings: ids.map((id) => ({ id })) });
  assert.equal(diffRuns(null, f('a')), null);
  assert.deepEqual(diffRuns(f('a', 'b'), f('b', 'c')), { new: 1, cleared: 1, unchanged: 1 });
});

test('purge removes state and cache dirs only', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  await inproc(['run', '--tier', 'T0', '--no-history'], h, state);
  mkdirSync(join(state, 'keep'));
  const r = await inproc(['purge'], h, state);
  assert.equal(r.code, 0);
  assert.ok(!existsSync(join(state, 'state')));
  assert.ok(existsSync(join(state, 'keep')));
  assert.ok(existsSync(h.claudeHome));
  h.cleanup();
});
