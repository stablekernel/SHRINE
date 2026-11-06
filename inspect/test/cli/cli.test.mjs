import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { setGitTestEnv, setGitVersion } from '../../src/io/git.mjs';
import { diffRuns } from '../../src/diff/previous.mjs';
import { makeHome, FIXED_NOW, REFUSE_ALL_REPOS } from '../synth/home.mjs';

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
  const t2 = await inproc(['run', '--tier', 'T2', '--json'], h, state);
  assert.equal(t2.code, 2);
  assert.equal(JSON.parse(t2.stderr).error.code, 'E_TIER');
  // T1 judges history, so it never runs with --no-history.
  const noHist = await inproc(['run', '--tier', 'T1', '--no-history', '--json'], h, state);
  assert.equal(noHist.code, 2);
  assert.equal(JSON.parse(noHist.stderr).error.code, 'E_TIER');
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

test('share-safe output hides folder names in home paths that contain spaces', async () => {
  const h = makeHome('good', {
    projectName: 'zz-widget-api',
    repoUnderHome: 'Zorblax Client Work/quux corp',
    repoFiles: { 'svc/fizz billing/CLAUDE.md': '# Billing service\n\nRun the billing tests before commit.\n' },
  });
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
  assert.equal(r.code, 0, r.stderr);
  const dir = JSON.parse(r.stdout).run_dir;
  const full = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.match(full, /fizz billing/, 'the planted nested file is in the full report');
  const html = readFileSync(join(dir, 'report.share-safe.html'), 'utf8');
  for (const leak of ['Zorblax', 'Client Work', 'quux', 'zz-widget-api', 'fizz', 'svc/']) {
    assert.ok(!html.includes(leak), `${leak} leaked into share-safe output`);
  }
  h.cleanup();
});

test('a partial clone on git without GIT_NO_LAZY_FETCH: history skipped, with a visible note', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  spawnSync('git', ['config', 'remote.origin.promisor', 'true'], { cwd: h.repo });
  setGitVersion([2, 44, 0]);
  try {
    const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
    assert.equal(r.code, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
    assert.ok(findings.notes.some((n) => n.startsWith('Git history was not read in 1 repo') && n.includes('git 2.44.0') && n.endsWith('Git 2.44.1 or later reads them safely.')), findings.notes.join('|'));
    // A run limit: visible near the top, never only in the collapsed tier-limits list.
    const visible = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
    const html = visible(readFileSync(join(s.run_dir, 'report.html'), 'utf8'));
    const at = html.indexOf('Git history was not read in 1 repo');
    assert.ok(at > 0 && at < html.indexOf('class="depth"'), 'the note sits above the depth band');
    assert.ok(!findings.unknowable.some((n) => n.startsWith('Git history was not read')), 'not a tier limit');
    assert.equal(findings.git_history_skipped, 1);
    const safe = visible(readFileSync(s.share_safe, 'utf8'));
    // The run-limits band carries the note; the banner stays one fixed line.
    assert.match(safe, /class="safe-banner">Share-safe copy: names, paths, and hosts are masked; session excerpts are removed\.<\/p>/);
    assert.ok(safe.indexOf('Git history was not read in 1 repo') > safe.indexOf('class="run-limits"'), 'the note sits in the band');
    assert.doesNotMatch(safe, /are not masked/, 'no warning about names that never reach this report');
    const spy = readFileSync(join(s.run_dir, 'spy.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(spy.filter((e) => e.op === 'spawn' && ['log', 'show', 'diff', 'status'].some((c) => e.args.includes(c)) && e.cwd?.startsWith(h.repo)), [], 'no history read in the repo');
  } finally {
    setGitVersion(undefined);
    h.cleanup();
  }
});

test('a git config include over 1 MiB is noted as a run limit and the run still writes both reports', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  try {
    writeFileSync(join(h.home, '.gitconfig'), '[include]\n\tpath = ~/big.cfg\n');
    writeFileSync(join(h.home, 'big.cfg'), `[user]\n\tname = Big Person\n${'#'.repeat(1 << 20)}\n`);
    const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
    assert.equal(r.code, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
    assert.ok(findings.run_limits.some((n) => n.startsWith('1 git config file was not read in full')), JSON.stringify(findings.run_limits));
    assert.ok(existsSync(s.share_safe));
  } finally {
    h.cleanup();
  }
});

// The run passes its env to knownIdentifiers, so a git identity set only under
// XDG_CONFIG_HOME is read. A T0 report never prints an author name, so the run limit
// for that file's oversized include is what shows the file was read.
test('a git config under XDG_CONFIG_HOME is read for share-safe masking', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  try {
    const xdg = join(h.tmp, 'xdg');
    mkdirSync(join(xdg, 'git'), { recursive: true });
    writeFileSync(join(xdg, 'git', 'config'), `[user]\n\tname = Xdg Only\n[include]\n\tpath = ${join(h.tmp, 'big.cfg')}\n`);
    writeFileSync(join(h.tmp, 'big.cfg'), `[user]\n\temail = xdg@initrode.example\n${'#'.repeat(1 << 20)}\n`);
    const e = { ...env(h, state), XDG_CONFIG_HOME: xdg };
    delete e.GIT_CONFIG_GLOBAL;
    const stdout = sink();
    const stderr = sink();
    const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], { env: e, home: h.home, stdin: { isTTY: false }, stdout, stderr });
    assert.equal(code, 0, stderr.text());
    const s = JSON.parse(stdout.text());
    const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
    assert.ok(findings.run_limits?.some((n) => n.startsWith('1 git config file was not read in full')), JSON.stringify(findings.run_limits));
    const safe = readFileSync(s.share_safe, 'utf8');
    assert.match(safe, /1 git config file was not read in full/);
    assert.ok(!safe.includes('Xdg Only'));
  } finally {
    h.cleanup();
  }
});

test('a repo git refuses to read (another owner) shows as a run limit, not a partial clone', async () => {
  const h = makeHome('good');
  const state = mkdtempSync(join(tmpdir(), 'si-state-'));
  setGitTestEnv(REFUSE_ALL_REPOS);
  setGitVersion([2, 44, 0]);
  try {
    const r = await inproc(['run', '--tier', 'T0', '--no-history', '--json'], h, state);
    assert.equal(r.code, 0, r.stderr);
    const findings = JSON.parse(readFileSync(join(JSON.parse(r.stdout).run_dir, 'findings.json'), 'utf8'));
    assert.ok(findings.run_limits.some((n) => n.startsWith('Git refused to read 1 repo owned by another user')), findings.run_limits.join('|'));
    assert.ok(!findings.run_limits.some((n) => n.startsWith('Git history was not read')), 'not reported as a partial clone');
  } finally {
    setGitTestEnv();
    setGitVersion(undefined);
    h.cleanup();
  }
});
