// Background runs (plan T3.1): start detaches a worker that writes its pid and
// log in the run folder; status reports running, gate, done, or died; resume
// restarts at the first missing .done marker; judging left unfinished never
// resumes without a fresh typed yes. Workers are this package's real bin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { plantedHome } from '../e2e/t1-helpers.mjs';

const FAKE_JUDGE = fileURLToPath(new URL('../fixtures/judge/fake-judge.mjs', import.meta.url));
const POSIX = process.platform !== 'win32';

const sink = () => {
  const c = [];
  return { write: (s) => c.push(String(s)), text: () => c.join('') };
};
const tty = (answer) => Object.assign(Readable.from([`${answer}\n`]), { isTTY: true });
const env = (h, state, extra = {}) => ({ ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]', ...extra });
async function inproc(argv, h, state, { stdin = { isTTY: false }, extra } = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env: env(h, state, extra), home: h.home, stdin, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
const status = async (h, state, id, extra) => JSON.parse((await inproc(['status', id, '--json'], h, state, { extra })).stdout);
async function until(h, state, id, pred, { extra, ms = 90_000 } = {}) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await status(h, state, id, extra);
    if (pred(s)) return s;
    if (Date.now() > end) assert.fail(`run ${id} never reached the expected state; last: ${JSON.stringify(s)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
const runFolder = (state, id) => join(state, 'state', 'runs', id);
const readState = (state, id) => JSON.parse(readFileSync(join(runFolder(state, id), 'state.json'), 'utf8'));

test('start detaches a worker: pid and log in the run folder, run id returned, worker pauses at Gate A', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  const r = await inproc(['start', '--tier', 'T0', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.match(s.run_id, /^\d{8}-\d+Z-[0-9a-f]{4}$/);
  assert.ok(Number.isInteger(s.pid) && s.pid !== process.pid);
  assert.equal(readFileSync(join(s.run_dir, 'worker.pid'), 'utf8').trim(), String(s.pid));
  assert.equal(s.log, join(s.run_dir, 'run.log'));
  const g = await until(h, state, s.run_id, (x) => x.state === 'gate');
  assert.equal(g.gate, 'A');
  assert.equal(g.next, `shrine-inspect approve ${s.run_id} A <no-history|history> --background`);
  assert.match(readFileSync(s.log, 'utf8'), /paused at Gate A/);
  assert.equal(readState(state, s.run_id).gates.A, null, 'the worker never answers a gate');
  h.cleanup();
});

test('approve --background answers in the terminal, then a worker finishes the run', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  const id = JSON.parse((await inproc(['start', '--tier', 'T0', '--json'], h, state)).stdout).run_id;
  await until(h, state, id, (x) => x.state === 'gate');
  const a = await inproc(['approve', id, 'A', 'no-history', '--background', '--json'], h, state, { stdin: tty('yes') });
  assert.equal(a.code, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).background, true);
  const done = await until(h, state, id, (x) => x.state === 'done');
  assert.ok(existsSync(done.report) && existsSync(done.share_safe));
  const st = readState(state, id);
  assert.equal(st.gates.A.by, 'tty');
  assert.equal(st.grant, undefined, 'the one-time grant is spent');
  h.cleanup();
});

test('approve refuses while a worker runs the same run (E_RUN_BUSY)', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  await inproc(['run', '--tier', 'T0'], h, state);
  const id = JSON.parse((await inproc(['status', '--json'], h, state)).stdout).run_id;
  writeFileSync(join(runFolder(state, id), 'worker.pid'), `${process.pid}\n`);
  const r = await inproc(['approve', id, 'A', 'history', '--json'], h, state, { stdin: tty('yes') });
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.stderr).error.code, 'E_RUN_BUSY');
  assert.equal((await status(h, state, id)).state, 'running');
  h.cleanup();
});

test('status reports died when the worker is gone with no report; resume restarts at the first missing .done', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr);
  const { run_id: id, run_dir: dir } = JSON.parse(r.stdout);
  const factsDone = readFileSync(join(dir, 'facts.done'), 'utf8');
  // A crash after facts: later markers and outputs gone, a dead worker pid left.
  for (const f of ['verify.done', 'findings.done', 'report.done', 'report.html', 'report.share-safe.html']) rmSync(join(dir, f));
  writeFileSync(join(dir, 'worker.pid'), '999999999\n');
  const s = await status(h, state, id);
  assert.equal(s.state, 'died');
  assert.equal(s.phase, 'facts');
  assert.equal(s.next, `shrine-inspect resume ${id}`);
  const w = await inproc(['resume', id, '--worker', '--json'], h, state);
  assert.equal(w.code, 0, w.stderr);
  assert.equal(readFileSync(join(dir, 'facts.done'), 'utf8'), factsDone, 'finished phases are not redone');
  assert.ok(existsSync(join(dir, 'report.done')));
  assert.equal((await status(h, state, id)).state, 'done');
  const again = await inproc(['resume', id, '--json'], h, state);
  assert.equal(again.code, 2);
  assert.equal(JSON.parse(again.stderr).error.code, 'E_RUN_DONE');
  h.cleanup();
});

test('resume never judges without a fresh yes: unfinished judging needs the one-time grant', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  await inproc(['run', '--tier', 'T0'], h, state);
  const id = JSON.parse((await inproc(['status', '--json'], h, state)).stdout).run_id;
  const st = readState(state, id);
  st.tier = 'T1';
  st.phase = 'judging';
  st.gates = { A: { choice: 'history', by: 'tty', at: FIXED_NOW }, B: { choice: 'T1', by: 'tty', at: FIXED_NOW } };
  st.grant = 'a'.repeat(32);
  writeFileSync(join(runFolder(state, id), 'state.json'), JSON.stringify(st));
  for (const argv of [['resume', id, '--json'], ['resume', id, '--worker', '--json'], ['resume', id, '--worker', '--grant', 'b'.repeat(32), '--json']]) {
    const r = await inproc(argv, h, state);
    assert.equal(r.code, 3, argv.join(' '));
    assert.equal(JSON.parse(r.stderr).error.code, 'E_NEEDS_YES');
  }
  assert.ok(!existsSync(join(runFolder(state, id), 'worker.pid')), 'no worker started');
  const s = await status(h, state, id);
  assert.equal(s.state, 'died');
  assert.equal(s.next, `shrine-inspect approve ${id} B --background`);
  h.cleanup();
});

test('a T1 run in the background: Gate B yes typed in the terminal, judging in the worker', { skip: !POSIX && 'needs a POSIX shell for the stand-in judge command' }, async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  // The worker runs the real bin, so the judge is a stand-in `claude` command on PATH.
  const bin = join(state, 'fakebin');
  mkdirSync(bin);
  const log = join(state, 'judge-launches.log');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${FAKE_JUDGE}" auto\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const extra = { PATH: `${bin}:${process.env.PATH}`, FAKE_JUDGE_LOG: log };
  const id = JSON.parse((await inproc(['start', '--tier', 'T1', '--json'], h, state, { extra })).stdout).run_id;
  await until(h, state, id, (x) => x.state === 'gate' && x.gate === 'A', { extra });
  assert.equal((await inproc(['approve', id, 'A', 'history', '--background'], h, state, { stdin: tty('yes'), extra })).code, 0);
  const b = await until(h, state, id, (x) => x.state === 'gate' && x.gate === 'B', { extra });
  assert.equal(b.next, `shrine-inspect approve ${id} B <T0|T1> --background`);
  assert.ok(!existsSync(log), 'nothing judged before the yes');
  assert.equal((await inproc(['approve', id, 'B', 'T1', '--background'], h, state, { stdin: tty('yes'), extra })).code, 0);
  const done = await until(h, state, id, (x) => x.state === 'done', { extra });
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 12);
  const findings = JSON.parse(readFileSync(join(done.run_dir, 'findings.json'), 'utf8'));
  assert.equal(findings.judging.judged, 12);
  h.cleanup();
});

test('status with no run id reports the newest run; no runs is a usage error', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  const none = await inproc(['status', '--json'], h, state);
  assert.equal(none.code, 2);
  assert.equal(JSON.parse(none.stderr).error.code, 'E_NO_RUN');
  await inproc(['run', '--tier', 'T0'], h, state);
  const s = JSON.parse((await inproc(['status', '--json'], h, state)).stdout);
  assert.equal(s.state, 'gate');
  const text = await inproc(['status'], h, state);
  assert.match(text.stdout, /waiting at Gate A for your answer\nAnswer in your own terminal: shrine-inspect approve/);
  h.cleanup();
});

test('--skill-version: a mismatch stops before any read; a match runs', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-bg-'));
  const bad = await inproc(['start', '--tier', 'T0', '--skill-version', '0.0.9', '--json'], h, state);
  assert.equal(bad.code, 2);
  const err = JSON.parse(bad.stderr).error;
  assert.equal(err.code, 'E_VERSION');
  assert.match(err.message, /0\.0\.9.*0\.1\.0/);
  assert.ok(!existsSync(join(state, 'state')), 'nothing read or written');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const ok = await inproc(['version', '--skill-version', pkg.version], h, state);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout, `shrine-inspect ${pkg.version}\n`);
  h.cleanup();
});
