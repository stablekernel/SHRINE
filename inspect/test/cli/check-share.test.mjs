import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { excerptsOf } from '../../src/cli/checkshare.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));
const TEMP = JSON.stringify(['^/nowhere/']);
const PROJECT = 'zanzibar-ledger';

function sink() {
  const chunks = [];
  return { write: (s) => chunks.push(String(s)), text: () => chunks.join('') };
}
function env(h, state) {
  return { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: TEMP, HOME: h.home };
}
async function inproc(argv, h, state) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { env: env(h, state), home: h.home, stdin: { isTTY: false }, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
async function t0Run() {
  const h = makeHome('good', { projectName: PROJECT });
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr);
  return { h, state, run: JSON.parse(r.stdout) };
}

test('--help, -h, help, and no command print usage and exit 0', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  for (const argv of [['--help'], ['-h'], ['help'], [], ['run', '--help'], ['approve', 'x', '-h']]) {
    const r = await inproc(argv, h, state);
    assert.equal(r.code, 0, argv.join(' '));
    assert.match(r.stdout, /^usage:/, argv.join(' '));
    assert.match(r.stdout, /check-share/);
    assert.equal(r.stderr, '');
  }
  h.cleanup();
});

test('an unknown command still exits 2 with usage on stderr', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['nope'], h, state);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown command nope/);
  assert.match(r.stderr, /usage:/);
  assert.equal(r.stdout, '');
  h.cleanup();
});

test('bin --help exits 0 as a child process', () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = spawnSync(process.execPath, [BIN, '--help'], { env: env(h, state), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /shrine-inspect run \[--tier T0\|T1\]/);
  assert.match(r.stdout, /shrine-inspect start --tier T0\|T1/);
  assert.match(r.stdout, /no --tier asks for one in an interactive terminal/);
  h.cleanup();
});

test('check-share passes a fresh share-safe report, and its control finds the project name', async () => {
  const { h, state } = await t0Run();
  const r = await inproc(['check-share', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const s = JSON.parse(r.stdout);
  assert.equal(s.ok, true, s.found.join(', '));
  assert.ok(s.checked.names >= 1);
  assert.ok(s.checked.paths >= 2, 'home and the project folder');
  assert.ok(s.control > 0, 'control: the local report shows the project name');
  const text = await inproc(['check-share'], h, state);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /^OK: /m);
  h.cleanup();
});

test('check-share fails with exit 5 on a share-safe copy with a planted name or path', async () => {
  const { h, state, run } = await t0Run();
  const safe = readFileSync(run.share_safe, 'utf8');
  const planted = join(h.tmp, 'to-send.html');
  writeFileSync(planted, safe.replace('</main>', `<p>see ${PROJECT} at ${h.repo}</p></main>`));
  // A file outside the run folder is checked against the newest run.
  const r = await inproc(['check-share', planted, '--json'], h, state);
  assert.equal(r.code, 5);
  const s = JSON.parse(r.stdout);
  assert.equal(s.ok, false);
  assert.ok(s.found.includes(`name: ${PROJECT}`), s.found.join(', '));
  assert.ok(s.found.some((x) => x.startsWith('path: ')), s.found.join(', '));
  const text = await inproc(['check-share', planted], h, state);
  assert.match(text.stdout, /NOT SAFE/);
  h.cleanup();
});

test('check-share by run id; a run without a report is a usage error', async () => {
  const { h, state, run } = await t0Run();
  assert.equal((await inproc(['check-share', run.run_id], h, state)).code, 0);
  assert.equal((await inproc(['check-share', 'no-such-run'], h, state)).code, 2);
  const paused = await inproc(['run', '--tier', 'T0'], h, state);
  assert.equal(paused.code, 3);
  const r = await inproc(['check-share', '--json'], h, state);
  assert.equal(r.code, 2);
  assert.equal(JSON.parse(r.stderr).error.code, 'E_NOT_DONE');
  h.cleanup();
});

test('excerptsOf: evidence, user-prompt pivots, and timeline labels; short text skipped', () => {
  const long = (s) => `${s} with enough words to count as an excerpt`;
  const findings = {
    findings: [{ evidence: [{ excerpt_scrubbed: long('evidence') }, { excerpt_scrubbed: 'short' }], pivot: { source: 'user_prompt', before_scrubbed: long('before'), after_scrubbed: long('after') }, episode_ref: { timeline: [{ label_scrubbed: long('label') }] } }],
    worth_a_look: [{ evidence: [], pivot: { source: 'shrine_generic', before_scrubbed: long('generic') } }],
  };
  assert.deepEqual(excerptsOf(findings).sort(), [long('after'), long('before'), long('evidence'), long('label')].sort());
});
