import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineOf, verifyRun } from '../../src/verify/verify.mjs';

function item(path) {
  const s = statSync(path);
  return { path, bytes: s.size, mtime_ms: s.mtimeMs, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'si-verify-'));
  const cfg = join(dir, 'settings.json');
  const log = join(dir, 'session.jsonl');
  writeFileSync(cfg, '{"a":1}');
  writeFileSync(log, '{"type":"user"}\n');
  return { cfg, log, base: baselineOf([item(cfg), item(log)]) };
}

test('unchanged files verify ok', () => {
  const { base } = setup();
  const r = verifyRun(base, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_paths, []);
  assert.equal(r.files_checked, 2);
});

test('a config file changed with a write open by inspect fails the run', () => {
  const { cfg, base } = setup();
  writeFileSync(cfg, '{"a":2,"b":3}');
  const r = verifyRun(base, [{ op: 'write', path: cfg, mode: 'w', t: 1 }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.changed_paths, [cfg]);
});

test('a change with no write open is "changed during run, not by inspect"', () => {
  const { cfg, base } = setup();
  writeFileSync(cfg, '{"a":2,"b":3}');
  const r = verifyRun(base, [{ op: 'open', path: cfg, mode: 'r', t: 1 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.note), ['changed during run, not by inspect']);
});

test('session log growth is attributed to other sessions, never a failure', () => {
  const { log, base } = setup();
  writeFileSync(log, '{"type":"user"}\n{"type":"assistant"}\n');
  const r = verifyRun(base, []);
  assert.equal(r.ok, true);
  assert.equal(r.changed_by_others[0].change, 'grew');
});

test('a non-allowlisted spawn in the spy log fails verification', () => {
  const { base } = setup();
  assert.equal(verifyRun(base, [{ op: 'spawn', cmd: 'sh', args: [] }]).ok, false);
});

test('a repo HEAD that moves after the baseline shows as HEAD moved, by others', async () => {
  const { execFileSync } = await import('node:child_process');
  const repo = mkdtempSync(join(tmpdir(), 'si-verify-repo-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  const g = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'ignore' });
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'one');
  const { heads } = baselineOf([], [repo]);
  g('commit', '-q', '--allow-empty', '-m', 'two');
  const r = verifyRun({ files: [], heads }, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['HEAD moved']);
});

test('a new promisor pack while HEAD and FETCH_HEAD stay put (lazy fetch) fails the run', async () => {
  const { execFileSync } = await import('node:child_process');
  const repo = mkdtempSync(join(tmpdir(), 'si-verify-git-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  execFileSync('git', ['init', '-q'], { cwd: repo, env });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'one'], { cwd: repo, env });
  const { heads } = baselineOf([], [repo]);
  assert.equal(verifyRun({ files: [], heads }, []).ok, true, 'no change verifies ok');
  const t_start = Date.now();
  for (const ext of ['pack', 'idx', 'promisor']) writeFileSync(join(repo, '.git', 'objects', 'pack', `pack-0000.${ext}`), 'x');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.changed_paths, [join(repo, '.git')]);
});

const inspectGit = (cwd, t_start, t) => ({ op: 'spawn', cmd: 'git', args: [], cwd, mode: 'x', t_start, t });

test('a promisor pack made between inspect git runs (a user lazy fetch) is reported, not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const now = Date.now();
  for (const ext of ['pack', 'idx', 'promisor']) writeFileSync(join(repo, '.git', 'objects', 'pack', `pack-0000.${ext}`), 'x');
  const other = mkdtempSync(join(tmpdir(), 'si-verify-other-'));
  const spy = [inspectGit(repo, now - 60_000, now - 59_000), inspectGit(repo, now + 59_000, now + 60_000), inspectGit(other, now - 1000, now + 1000)];
  const r = verifyRun({ files: [], heads }, spy);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

test('a new pack with no promisor sidecar, or an in-flight tmp pack, is not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const t_start = Date.now();
  writeFileSync(join(repo, '.git', 'objects', 'pack', 'pack-0000.pack'), 'x');
  writeFileSync(join(repo, '.git', 'objects', 'pack', 'tmp_pack_abc123'), 'x');
  writeFileSync(join(repo, '.git', 'objects', 'pack', 'tmp_pack_def456.promisor'), 'x');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

test('a user repack during the scan is reported, not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo, g } = gitRepo(execFileSync);
  g('commit', '-q', '--allow-empty', '-m', 'two');
  g('repack', '-q', '-d');
  g('commit', '-q', '--allow-empty', '-m', 'three');
  const { heads } = baselineOf([], [repo]);
  g('repack', '-q', '-a', '-d');
  const r = verifyRun({ files: [], heads }, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

test('a fetch with --no-write-fetch-head during the scan is reported, not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo, g } = gitRepo(execFileSync);
  const { repo: other, g: go } = gitRepo(execFileSync);
  writeFileSync(join(other, 'f'), 'f');
  go('add', 'f');
  go('commit', '-q', '-m', 'f');
  const { heads } = baselineOf([], [repo]);
  g('-c', 'fetch.unpackLimit=1', 'fetch', '-q', '--no-write-fetch-head', other, 'HEAD:refs/prefetch/x');
  const r = verifyRun({ files: [], heads }, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

function gitRepo(execFileSync) {
  const repo = mkdtempSync(join(tmpdir(), 'si-verify-user-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  const g = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'ignore' });
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'one');
  return { repo, g };
}

test('a user git add during the scan is reported, not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo, g } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(join(repo, 'b'), 'b');
  g('add', 'b');
  const r = verifyRun({ files: [], heads }, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_paths, []);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

test('a new promisor pack that arrives with a FETCH_HEAD update is a user fetch, not inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const t_start = Date.now();
  for (const ext of ['pack', 'promisor']) writeFileSync(join(repo, '.git', 'objects', 'pack', `pack-0000.${ext}`), 'x');
  writeFileSync(join(repo, '.git', 'FETCH_HEAD'), '');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

test('a new promisor pack while another pack is removed is a user repack, not inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo, g } = gitRepo(execFileSync);
  g('repack', '-q', '-a', '-d');
  const packDir = join(repo, '.git', 'objects', 'pack');
  const old = readdirSync(packDir).filter((n) => n.endsWith('.pack'));
  assert.ok(old.length > 0, 'repo starts with a pack');
  const { heads } = baselineOf([], [repo]);
  const t_start = Date.now();
  for (const n of old) rmSync(join(packDir, n));
  for (const ext of ['pack', 'promisor']) writeFileSync(join(packDir, `pack-0000.${ext}`), 'x');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});
