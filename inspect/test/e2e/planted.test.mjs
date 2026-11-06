// Planted-failure suite with synthetic histories (plan T2.11, E5: 3 plants; the
// done-without-test kind and the retry count are appendix counts). Runs the real
// CLI in process with history consent answered on a fake TTY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory, addSession, COMMIT_AT_MS, PRESETS } from '../synth/history.mjs';
import { makeRepo, openRepo } from '../synth/repos.mjs';
import { resetGitTimeouts, setGitVersion } from '../../src/io/git.mjs';
import { setSpawnTimeout } from '../../src/io/proc.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
const PLANTS = ['stale_instructions', 'blanket_permissions', 'oversized_instructions'];
const sink = () => {
  const c = [];
  return { write: (s) => c.push(String(s)), text: () => c.join('') };
};

async function runWithHistory(h) {
  const state = mkdtempSync(join(tmpdir(), 'si-pl-'));
  const stdout = sink();
  const stderr = sink();
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const stdin = Object.assign(Readable.from(['history\n']), { isTTY: true });
  const code = await main(['run', '--tier', 'T0', '--json'], { env, home: h.home, stdin, stdout, stderr });
  const dir = JSON.parse(stdout.text() || '{}').run_dir;
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  return { code, stderr: stderr.text(), dir, findings: dir && JSON.parse(read('findings.json')), facts: dir && JSON.parse(read('facts.json')), spy: dir && read('spy.jsonl').trim().split('\n').map((l) => JSON.parse(l)), read };
}

function treeHash(root) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = lstatSync(p);
      h.update(`${relative(root, p)}|${s.mode}|${s.size}|${s.mtimeMs}\n`);
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) h.update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest('hex');
}

const home = (name, preset, opts = {}) => {
  const h = makeHome(name, { sessionMtime: new Date(NOW - 25 * DAY) });
  if (preset) addHistory(h, preset, { nowMs: NOW, ...opts });
  return h;
};

test('planted: recall of the 3 planted kinds is 80% or more; usage stays in the appendix with the retry count', async () => {
  const h = home('bad', 'planted');
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  const kinds = new Set(r.findings.findings.map((f) => f.kind));
  const recall = PLANTS.filter((k) => kinds.has(k)).length / PLANTS.length;
  assert.ok(recall >= 0.8, `recall ${recall}`);
  assert.ok(!r.findings.findings.some((f) => f.lens === 'usage'), 'no usage finding at T0 (E5)');
  const u = r.findings.usage;
  assert.equal(u.counts.sessions, 12);
  assert.ok(u.counts.retries >= 12, 'one ls retry per planted session');
  assert.ok(u.counts.done_without_test >= 12);
  assert.ok(u.counts.correction_candidates >= 12);
  assert.ok(u.lines.some((l) => /^Identical tool-call retries: \d+ of \d+ tool calls/.test(l)));
  assert.ok(u.lines.some((l) => /^Done claims with no test or check run before them/.test(l)));
  assert.match(r.read('report.html'), /Usage from session history/);
  // Nothing to drop in this history; one repo holds every episode, so the rates say so.
  assert.equal(u.counts.resent_messages, 0);
  assert.equal(u.counts.forked_sessions, 0);
  assert.ok(!u.lines.some((l) => /^Dropped before counting/.test(l)));
  assert.ok(u.lines.some((l) => /^One project: all \d+ episodes come from 1 project/.test(l)), u.lines.join('\n'));
  assert.ok(u.lines.some((l) => /^Identical tool-call retries: .*Mostly 1 project: 100% of episodes\.$/.test(l)));
  // With no linked commits the rework line says so and the later-session fix line is left out.
  const linked = u.counts.linked_commits > 0;
  const rework = linked ? [/^Rework \(named reverts\) within 72 hours: \d+ of \d+ episodes? with linked commits/, /^Possible rework \(later-session fix\)/] : [/^Rework \(named reverts\) within 72 hours: no episode has a linked commit/];
  if (!linked) assert.ok(!u.lines.some((l) => /0 of 0|^Possible rework \(later-session fix\)/.test(l)), u.lines.join('\n'));
  for (const re of [...rework, /^Possible rework \(file overlap\)/, /^Iteration commits: /]) {
    assert.ok(u.lines.some((l) => re.test(l)), String(re));
  }
  h.cleanup();
});

test('rework from real commits: a named revert in a later session is rework; a later-session fix is a candidate', async () => {
  const h = home('good', 'clean');
  const repo = openRepo(h.repo);
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600000;
  const T = NOW - 10 * DAY;
  const id = (n) => `abab0000-0000-4000-8000-00000000000${n}`;
  repo.commit(iso(T - H), 'base', { 'src/parser.js': 'v0', 'src/lexer.js': 'v0' });
  // S1 makes the commit; S2 reverts it by name 3 hours later; S3 fixes the same file 5 hours later.
  addSession(h, { id: id(1), startMs: T, script: PRESETS.committing(1) });
  const made = repo.commit(iso(T + COMMIT_AT_MS), 'feat: parser step 1', { 'src/parser.js': 'v1', 'src/lexer.js': 'v1' });
  addSession(h, { id: id(2), startMs: T + 3 * H, script: [['human', 'Undo the parser step.'], ['bash', `git revert --no-edit ${made.slice(0, 7)}`]] });
  repo.revert(iso(T + 3 * H + COMMIT_AT_MS), made);
  addSession(h, { id: id(3), startMs: T + 5 * H, script: PRESETS.committing(3) });
  repo.commit(iso(T + 5 * H + COMMIT_AT_MS), 'fix: parser empty input', { 'src/parser.js': 'v2' });
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  const c = r.findings.usage.counts;
  assert.ok(c.committed >= 2, `committed ${c.committed}`);
  assert.ok(c.rework >= 1, `rework ${c.rework}`);
  assert.ok(c.possible_fix >= 1, `possible_fix ${c.possible_fix}`);
  const ep = r.facts.episodes.find((e) => e.commits.includes(made));
  assert.equal(ep.stratum.outcome, 'rework');
  h.cleanup();
});

test('a repo whose git history is skipped is left out of commit counts and named in the note', async () => {
  const h = home('good', 'clean');
  const r2 = makeRepo();
  const iso = (ms) => new Date(ms).toISOString();
  const T = NOW - 10 * DAY;
  r2.commit(iso(T - 3600000), 'base', { 'src/parser.js': 'v0' });
  const made = [1, 2, 3].map((i) => {
    addSession(h, { id: `acac0000-0000-4000-8000-00000000000${i}`, cwd: r2.root, startMs: T + i * DAY, script: PRESETS.committing(i) });
    return r2.commit(iso(T + i * DAY + COMMIT_AT_MS), `parser step ${i}`, { [`src/p${i}.js`]: `v${i}` });
  });
  r2.revert(iso(T + DAY + 3 * 3600000), made[0]);
  try {
    const base = (await runWithHistory(h)).findings.usage.counts;
    assert.equal(base.linked_commits, 3);
    assert.equal(base.rework, 1);
    assert.equal(base.history_unread, 0);
    r2.git(['config', 'remote.origin.promisor', 'true']);
    r2.git(['config', 'extensions.partialclone', 'origin']);
    setGitVersion([2, 40, 0]);
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    const c = r.findings.usage.counts;
    assert.equal(c.committed_unlinked, base.committed_unlinked, 'skipped episodes are not unlinked commits');
    assert.equal(c.linked_commits, 0);
    assert.equal(c.rework, 0);
    assert.equal(c.history_unread, 3);
    const lines = r.findings.usage.lines.join('\n');
    assert.match(lines, /History not read: 3 episodes ran a commit command in a repo whose git history was not read, left out of rework and commit-link counts\./);
    assert.match(lines, /Rework \(named reverts\) within 72 hours: n\/a, no episode in a repo with git history read has a linked commit\./);
    assert.ok(r.findings.notes.some((n) => /Git history was not read in 1 repo.*Rework and commit links there were not counted: 3 episodes with a commit command left out\./.test(n)), r.findings.notes.join('\n'));
  } finally {
    setGitVersion(undefined);
    r2.cleanup();
    h.cleanup();
  }
});

test('a repo where git log fails is history not read, not unlinked commits, and the note names it', async () => {
  const h = home('good', 'clean');
  const r2 = makeRepo();
  const iso = (ms) => new Date(ms).toISOString();
  const T = NOW - 10 * DAY;
  r2.commit(iso(T - 3600000), 'base', { 'src/parser.js': 'v0' });
  const made = [1, 2].map((i) => {
    addSession(h, { id: `adad0000-0000-4000-8000-00000000000${i}`, cwd: r2.root, startMs: T + i * DAY, script: PRESETS.committing(i) });
    return r2.commit(iso(T + i * DAY + COMMIT_AT_MS), `parser step ${i}`, { [`src/p${i}.js`]: `v${i}` });
  });
  r2.revert(iso(T + DAY + 3 * 3600000), made[0]);
  // A git that refuses this one repo the way git does for a repo another user owns.
  const bin = mkdtempSync(join(tmpdir(), 'si-fakegit-'));
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const target = realpathSync(r2.root);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" log "*) if [ "$(pwd -P)" = '${target}' ]; then echo "fatal: detected dubious ownership in repository at '${target}'" >&2; exit 128; fi;; esac\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  try {
    const base = (await runWithHistory(h)).findings.usage.counts;
    assert.equal(base.linked_commits, 2);
    assert.equal(base.rework, 1);
    assert.equal(base.history_unread, 0);
    process.env.PATH = `${bin}:${path}`;
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    const c = r.findings.usage.counts;
    assert.equal(c.committed_unlinked, base.committed_unlinked, 'a refused repo is not unlinked commits');
    assert.equal(c.linked_commits, 0);
    assert.equal(c.rework, 0);
    assert.equal(c.history_unread, 2);
    assert.match(r.findings.usage.lines.join('\n'), /History not read: 2 episodes ran a commit command/);
    const note = r.findings.run_limits.find((n) => n.startsWith('Git could not read commit history in 1 repo'));
    assert.ok(note, r.findings.run_limits.join('\n'));
    assert.match(note, /repo \(git refused it: the repo is owned by another user\)\. Rework and commit links there were not counted: 2 episodes with a commit command left out\./);
    assert.ok(!r.findings.run_limits.some((n) => n.startsWith('Git history was not read')), 'not reported as a partial clone');
    assert.ok(r.findings.notes.includes(note));
  } finally {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    r2.cleanup();
    h.cleanup();
  }
});

// 2.50.1 reads history safely; on 2.44.0 the refusal must not read as a partial clone.
for (const v of [[2, 50, 1], [2, 44, 0]]) test(`a repo git refuses during setup keeps the not-owned reason when the linker reaches it (git ${v.join('.')})`, async () => {
  const h = home('good', 'clean');
  const r2 = makeRepo();
  const iso = (ms) => new Date(ms).toISOString();
  const T = NOW - 10 * DAY;
  // A CLAUDE.md makes setup read this repo with git before the linker does.
  r2.commit(iso(T - 3600000), 'base', { 'CLAUDE.md': '# Parser\n\nRun the parser tests.\n', 'src/parser.js': 'v0' });
  addSession(h, { id: 'aeae0000-0000-4000-8000-000000000001', cwd: r2.root, startMs: T + DAY, script: PRESETS.committing(1) });
  r2.commit(iso(T + DAY + COMMIT_AT_MS), 'parser step 1', { 'src/p1.js': 'v1' });
  // A git that refuses every run in this one repo, as git does for another owner.
  const bin = mkdtempSync(join(tmpdir(), 'si-fakegit-'));
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const target = realpathSync(r2.root);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$(pwd -P)" in '${target}'|'${target}'/*) case "$1" in --version|version) ;; *) echo "fatal: detected dubious ownership in repository at '${target}'" >&2; exit 128;; esac;; esac\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  setGitVersion(v);
  try {
    process.env.PATH = `${bin}:${path}`;
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.findings.run_limits.some((n) => n.startsWith('Git refused to read 1 repo owned by another user')), 'setup saw the refusal first');
    const note = r.findings.run_limits.find((n) => n.startsWith('Git could not read commit history in 1 repo'));
    assert.ok(note, r.findings.run_limits.join('\n'));
    assert.match(note, /\(git refused it: the repo is owned by another user\)\. Rework and commit links there were not counted: 1 episode with a commit command left out\./);
    assert.doesNotMatch(note, /git log failed/);
    assert.ok(!r.findings.run_limits.some((n) => n.startsWith('Git history was not read')), 'not reported as a partial clone');
    assert.equal(r.findings.usage.counts.history_unread, 1);
  } finally {
    process.env.PATH = path;
    setGitVersion(undefined);
    rmSync(bin, { recursive: true, force: true });
    r2.cleanup();
    h.cleanup();
  }
});

test('a repo where git hung during setup is history not read in the scan, with its episodes counted', { timeout: 30_000 }, async () => {
  const h = home('good', 'clean');
  const r2 = makeRepo();
  const iso = (ms) => new Date(ms).toISOString();
  const T = NOW - 10 * DAY;
  r2.commit(iso(T - 3600000), 'base', { 'CLAUDE.md': '# Parser\n\nRun the parser tests.\n', 'src/parser.js': 'v0' });
  for (const i of [1, 2]) {
    addSession(h, { id: `afaf0000-0000-4000-8000-00000000000${i}`, cwd: r2.root, startMs: T + i * DAY, script: PRESETS.committing(i) });
    r2.commit(iso(T + i * DAY + COMMIT_AT_MS), `parser step ${i}`, { [`src/p${i}.js`]: `v${i}` });
  }
  // A git that hangs on every run in this one repo, past a short spawn limit.
  const bin = mkdtempSync(join(tmpdir(), 'si-fakegit-'));
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const target = realpathSync(r2.root);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase "$(pwd -P)" in '${target}'|'${target}'/*) case "$1" in --version|version) ;; *) exec sleep 5;; esac;; esac\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  setGitVersion([2, 50, 1]);
  setSpawnTimeout(500);
  try {
    process.env.PATH = `${bin}:${path}`;
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.findings.usage.counts.history_unread, 2);
    assert.equal(r.findings.usage.counts.linked_commits, 0);
    const note = r.findings.run_limits.find((n) => n.startsWith('Git could not read commit history in 1 repo'));
    assert.ok(note, r.findings.run_limits.join('\n'));
    assert.match(note, /\(git timed out\)\. Rework and commit links there were not counted: 2 episodes with a commit command left out\./);
  } finally {
    process.env.PATH = path;
    setSpawnTimeout();
    resetGitTimeouts();
    setGitVersion(undefined);
    rmSync(bin, { recursive: true, force: true });
    r2.cleanup();
    h.cleanup();
  }
});

for (const preset of ['clean', 'expert']) {
  test(`${preset} history on a good setup: zero findings, nothing in amplify above low`, async () => {
    const h = home('good', preset);
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.findings.findings.map((f) => f.kind), []);
    assert.ok(!r.findings.findings.some((f) => f.tab === 'amplify' && f.severity.label !== 'low'));
    assert.equal(r.findings.history.read, true);
    assert.equal(r.findings.usage.counts.done_without_test, 0);
    h.cleanup();
  });
}

test('sdk-cli sessions: housekeeping counted, spawned work linked as byproducts or unattributed, mixed folders keep interactive sessions', async () => {
  const h = home('good', 'clean');
  const bot = join(h.tmp, 'work', 'bot');
  // A folder whose newest file is housekeeping, with one older interactive session in it.
  addHistory(h, 'clean', { nowMs: NOW, prefix: 'dddd', count: 1, cwd: bot });
  addHistory(h, 'housekeeping', { nowMs: NOW, prefix: 'bbbb', entrypoint: 'sdk-cli', count: 4, first: 5, cwd: bot });
  // In the project folder: 3 spawned during clean sessions, 1 spawned with no parent, 1 housekeeping.
  addHistory(h, 'spawned', { nowMs: NOW, prefix: 'cccc', entrypoint: 'sdk-cli', count: 3, offsetMs: 60000 });
  addHistory(h, 'spawned', { nowMs: NOW, prefix: 'eeee', entrypoint: 'sdk-cli', count: 1, offsetMs: 6 * 3600000 });
  addHistory(h, 'housekeeping', { nowMs: NOW, prefix: 'ffff', entrypoint: 'sdk-cli', count: 1, offsetMs: 7 * 3600000 });
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.findings.findings, []);
  assert.deepEqual(r.findings.usage.automation, { housekeeping: 5, spawned: 4, total: 18, share: 0.278, spawned_linked: 3, spawned_parents: 3, unattributed: 1 });
  const lines = r.findings.usage.lines;
  assert.ok(lines.includes('Housekeeping automation left out: 5 of 18 sessions (28%)'));
  assert.ok(lines.includes('Spawned automation: 3 sessions linked to 3 of your sessions as byproducts, not judged'));
  assert.ok(lines.includes('Unattributed automation: 1 session with no parent session found, not read'));
  assert.equal(r.findings.usage.counts.sessions, 13, '12 clean plus the interactive session in the housekeeping folder');
  assert.equal(r.findings.usage.automation.total, r.findings.usage.automation.housekeeping + r.findings.usage.counts.sessions, 'housekeeping denominator = reviewed + left out');
  assert.equal(r.facts.sessions.filter((s) => s.byproducts > 0).length, 3);
  const streamed = r.spy.filter((e) => e.stream).map((e) => e.path);
  assert.ok(streamed.length >= 13, `${streamed.length} session logs streamed`);
  assert.ok(!streamed.some((p) => /\/(bbbb|cccc|eeee|ffff)/.test(p)), 'sdk-cli sessions are never read in full');
  h.cleanup();
});

test('zero model calls: the spawn log holds only allowlisted git; home tree byte-identical; share-safe copy leaks no identifier', async () => {
  const h = home('bad', 'planted');
  const before = treeHash(h.tmp);
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(treeHash(h.tmp), before);
  const spawns = r.spy.filter((e) => e.op === 'spawn');
  assert.ok(spawns.length > 0);
  for (const s of spawns) assert.equal(s.cmd, 'git', `non-git spawn ${s.cmd}`);
  assert.ok(r.spy.filter((e) => e.stream).length >= 12, 'session logs were streamed');
  assert.ok(r.spy.some((e) => e.op === 'open'), 'file opens were logged');
  assert.ok(r.spy.every((e) => e.op !== 'open' || e.mode === 'r'));
  assert.equal(JSON.parse(r.read('verify.json')).ok, true);
  const safe = r.read('report.share-safe.html');
  for (const leak of [h.home, h.tmp, 'bad-project', 'Fixture Author', 'author@fixture.example', 'keep the old function name']) assert.ok(!safe.includes(leak), `share-safe leaks ${leak}`);
  const facts = r.read('facts.json');
  assert.ok(!facts.includes('keep the old function name'), 'no prompt text at rest');
  h.cleanup();
});

test('core keys missing in every session file: setup-only report and exit 4', async () => {
  const h = makeHome('good', { sessionMtime: new Date(NOW - 25 * DAY) });
  const dir = join(h.claudeHome, 'projects', encodeProjectPath(h.repo));
  writeFileSync(join(dir, 'broken-1.jsonl'), `${JSON.stringify({ type: 'user', cwd: h.repo, message: { role: 'user', content: 'x' } })}\n`);
  const r = await runWithHistory(h);
  assert.equal(r.code, 4, r.stderr);
  assert.equal(r.findings.history.read, false);
  assert.match(r.findings.notes.join(' '), /none could be parsed/);
  assert.ok(r.findings.skipped_files.length >= 1);
  h.cleanup();
});
