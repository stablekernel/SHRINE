import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory, addSession, PRESETS } from '../synth/history.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
const sink = () => {
  const c = [];
  return { write: (s) => c.push(String(s)), text: () => c.join('') };
};
const tty = (answer) => Object.assign(Readable.from([`${answer}\n`]), { isTTY: true });
async function inproc(argv, h, state, stdin = { isTTY: false }) {
  const stdout = sink();
  const stderr = sink();
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const code = await main(argv, { env, home: h.home, stdin, stdout, stderr });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}
const runDir = (state) => join(state, 'state', 'runs', readdirSync(join(state, 'state', 'runs')).sort().at(-1));
const json = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

function homeWithHistory(name = 'good', preset = 'clean') {
  const h = makeHome(name, { sessionMtime: new Date(NOW - 25 * DAY) });
  addHistory(h, preset, { nowMs: NOW });
  return h;
}

test('Gate A is itemized: projects, date range, size, size-based estimate, tier note', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state);
  assert.equal(r.code, 3);
  const g = json(runDir(state), 'gate.json');
  assert.equal(g.history.projects, 1);
  assert.equal(g.history.sessions, 13);
  assert.ok(g.history.bytes > 0);
  assert.equal(typeof g.history.estimate_seconds, 'number');
  assert.ok(g.history.from <= g.history.to);
  assert.match(g.tier.note, /Deeper tiers are not available/);
  h.cleanup();
});

test('without a yes, no session log is streamed; the TTY prompt shows the itemized gate', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state, tty('no-history'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /History if yes: 13 session files in 1 project,/);
  assert.match(r.stderr, /Estimated time with history: under 1 minute/);
  // Exact about what Gate A read: the first lines can hold a prompt, so the text never claims none was read.
  assert.match(r.stderr, /the first 10 lines of the newest session file per folder are read to find its folder/);
  assert.match(r.stderr, /no prompt text is kept or shown/);
  assert.doesNotMatch(r.stderr, /No prompt is read/);
  const dir = runDir(state);
  const spy = readFileSync(join(dir, 'spy.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(spy.filter((e) => e.stream).length, 0, 'no session log streamed');
  // Any other open of a session log (readBytes, readText) would be a full read.
  const sessionOpens = spy.filter((e) => e.op === 'open' && /\/projects\/.*\.jsonl$/.test(e.path));
  assert.ok(sessionOpens.length > 0, 'Gate A sampled cwd');
  assert.deepEqual(sessionOpens.filter((e) => e.bounded !== true), [], 'session logs opened only through the bounded readLines path');
  const facts = json(dir, 'facts.json');
  assert.deepEqual(facts.sessions, []);
  assert.equal(facts.consent.A.choice, 'no-history');
  h.cleanup();
});

test('a yes reads history: sessions, episodes, harness version, consent, and a re-run asks again', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const r = await inproc(['run', '--tier', 'T0', '--json'], h, state, tty('history'));
  assert.equal(r.code, 0, r.stderr);
  const dir = runDir(state);
  const facts = json(dir, 'facts.json');
  assert.equal(facts.sessions.length, 12, 'the stub file has no core keys and is skipped');
  assert.ok(facts.episodes.length >= 12);
  assert.equal(facts.run.harness.version, '2.1.318');
  assert.equal(facts.consent.A.choice, 'history');
  assert.equal(facts.consent.A.by, 'tty');
  assert.equal(facts.consent.B.choice, 'T0');
  assert.ok(facts.run.scope.from && facts.run.scope.to);
  const findings = json(dir, 'findings.json');
  assert.equal(findings.history.read, true);
  assert.equal(findings.history.sessions, 12);
  assert.deepEqual(findings.skipped_files.map((s) => s.reason), ['core keys missing']);
  const again = await inproc(['run', '--tier', 'T0'], h, state);
  assert.equal(again.code, 3, 'consent is never reused');
  h.cleanup();
});

test('the driving session is left out: --session-id, else the newest growing file; named at Gate A, listed in verify.json', async () => {
  const h = homeWithHistory();
  addSession(h, { id: 'live-session-0001', startMs: NOW - 10 * 60000, script: PRESETS.planted(1), mtime: new Date(NOW - 30000) });
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state, tty('history'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /Left out: session live-ses/);
  const dir = runDir(state);
  assert.deepEqual(json(dir, 'verify.json').excluded_session_ids, ['live-session-0001']);
  const sessions = json(dir, 'facts.json').sessions;
  assert.ok(sessions.length > 0, 'other sessions were read');
  assert.ok(!sessions.some((s) => s.id === 'live-session-0001'));

  const state2 = mkdtempSync(join(tmpdir(), 'si-st-'));
  const flagged = 'aaaa0000-0000-4000-8000-000000000003';
  await inproc(['run', '--tier', 'T0', '--session-id', flagged], h, state2, tty('history'));
  const dir2 = runDir(state2);
  assert.deepEqual(json(dir2, 'verify.json').excluded_session_ids, [flagged]);
  const ids = json(dir2, 'facts.json').sessions.map((s) => s.id);
  assert.ok(!ids.includes(flagged));
  assert.ok(ids.includes('live-session-0001'), 'with --session-id, the growing file is scanned');
  h.cleanup();
});

test('sessions-since for a memory folder of a session cwd below the root counts that project only', async () => {
  const h = makeHome('good', { sessionMtime: new Date(NOW - 25 * DAY) });
  const sub = join(h.repo, 'pkg');
  const other = join(h.tmp, 'work', 'other');
  mkdirSync(sub, { recursive: true });
  mkdirSync(other, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: other, env: { ...process.env, GIT_CONFIG_GLOBAL: devNull } });
  addHistory(h, 'clean', { nowMs: NOW, cwd: sub, prefix: 'aaaa', count: 3 });
  addHistory(h, 'clean', { nowMs: NOW, cwd: other, prefix: 'bbbb', count: 12 });
  const mem = join(h.claudeHome, 'projects', encodeProjectPath(sub), 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '# mem\n- some rule that is long enough to count here\n');
  const old = new Date(NOW - 300 * DAY);
  utimesSync(join(mem, 'MEMORY.md'), old, old);
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const r = await inproc(['run', '--tier', 'T0'], h, state, tty('history'));
  assert.equal(r.code, 0, r.stderr);
  const f = json(runDir(state), 'findings.json');
  assert.equal(f.history.sessions, 15);
  const hit = [...f.findings, ...f.worth_a_look].find((x) => x.items?.[0]?.path?.endsWith('/memory/MEMORY.md'));
  assert.ok(hit, 'the stale memory file is reported');
  assert.equal(hit.config_strip.sessions_since, 3, 'only sessions of the project that loads that memory folder');
  h.cleanup();
});

test('approve with history resumes a paused run and reads history', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  await inproc(['run', '--tier', 'T0'], h, state);
  const id = readdirSync(join(state, 'state', 'runs'))[0];
  const r = await inproc(['approve', id, 'A', 'history'], h, state, tty('yes'));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(json(join(state, 'state', 'runs', id), 'facts.json').sessions.length, 12);
  h.cleanup();
});

test('a resumed run reads only the files itemized at Gate A, with the same own-session decision', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  await inproc(['run', '--tier', 'T0'], h, state);
  const id = readdirSync(join(state, 'state', 'runs'))[0];
  // A session that appears after Gate A was shown, and still growing at approve time.
  addSession(h, { id: 'late-session-0001', startMs: NOW - 10 * 60000, script: PRESETS.planted(2), mtime: new Date(NOW - 10000) });
  const r = await inproc(['approve', id, 'A', 'history'], h, state, tty('yes'));
  assert.equal(r.code, 0, r.stderr);
  const dir = join(state, 'state', 'runs', id);
  const ids = json(dir, 'facts.json').sessions.map((s) => s.id);
  assert.equal(ids.length, 12);
  assert.ok(!ids.includes('late-session-0001'), 'not itemized at Gate A');
  assert.deepEqual(json(dir, 'verify.json').excluded_session_ids, [], 'Gate A reported no own session');
  h.cleanup();
});

test('a config write during the history scan is reported as changed by others', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  const target = join(h.home, '.claude', 'CLAUDE.md');
  let wrote = false;
  const stdout = sink();
  const stderr = sink();
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const onScanProgress = () => {
    if (!wrote) writeFileSync(target, `${readFileSync(target, 'utf8')}\nedited during the scan\n`);
    wrote = true;
  };
  const code = await main(['run', '--tier', 'T0'], { env, home: h.home, stdin: tty('history'), stdout, stderr, onScanProgress });
  assert.equal(code, 0, stderr.text());
  assert.ok(wrote, 'the scan reported progress');
  const v = json(runDir(state), 'verify.json');
  assert.ok(v.changed_by_others.some((c) => c.path.endsWith('.claude/CLAUDE.md') && c.change === 'modified'), JSON.stringify(v.changed_by_others));
  h.cleanup();
});

test('a lazy fetch during a setup git run is reported, not baked into the baseline', async () => {
  const h = homeWithHistory();
  const state = mkdtempSync(join(tmpdir(), 'si-st-'));
  // Test-only git wrapper: a setup date lookup (log --format=%cI) drops a promisor pack,
  // standing in for a partial clone fetching objects on demand.
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = mkdtempSync(join(tmpdir(), 'si-bin-'));
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$*" in *%cI*) d=$("${realGit}" rev-parse --git-common-dir 2>/dev/null) && [ -n "$d" ] && touch "$d/objects/pack/pack-lazy$$.promisor";; esac\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const r = await inproc(['run', '--tier', 'T0'], h, state, tty('history'));
    assert.equal(r.code, 5, r.stderr);
    const v = json(runDir(state), 'verify.json');
    assert.equal(v.ok, false);
    assert.ok(v.changed_paths.some((p) => p.endsWith('.git')), JSON.stringify(v));
  } finally {
    process.env.PATH = path;
    h.cleanup();
  }
});
