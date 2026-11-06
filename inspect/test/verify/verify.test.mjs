import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, statSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  execFileSync('git', ['config', 'remote.origin.promisor', 'true'], { cwd: repo, env });
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

// A repo-config bundle URI (old git, no GIT_NO_LAZY_FETCH) unbundles a plain pack
// with no .promisor sidecar, and an http one also fills objects/bundles: either
// inside an inspect git run in a partial clone is inspect's.
for (const [label, write] of [
  ['a plain pack', (git) => writeFileSync(join(git, 'objects', 'pack', 'pack-0000.pack'), 'x')],
  ['a bundle', (git) => {
    mkdirSync(join(git, 'objects', 'bundles'));
    writeFileSync(join(git, 'objects', 'bundles', 'b-0000.bundle'), 'x');
  }],
]) {
  test(`${label} written inside an inspect git run in a partial clone fails the run`, async () => {
    const { execFileSync } = await import('node:child_process');
    const { repo } = gitRepo(execFileSync);
    const { heads } = baselineOf([], [repo]);
    const t_start = Date.now();
    write(join(repo, '.git'));
    const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.changed_paths, [join(repo, '.git')]);
  });

  test(`${label} written inside an inspect git run in a full clone is reported, not blamed`, async () => {
    const { execFileSync } = await import('node:child_process');
    const { repo } = gitRepo(execFileSync, { partial: false });
    const { heads } = baselineOf([], [repo]);
    const t_start = Date.now();
    write(join(repo, '.git'));
    const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
  });

  test(`${label} written between inspect git runs is reported, not blamed on inspect`, async () => {
    const { execFileSync } = await import('node:child_process');
    const { repo } = gitRepo(execFileSync);
    const { heads } = baselineOf([], [repo]);
    const now = Date.now();
    write(join(repo, '.git'));
    const r = verifyRun({ files: [], heads }, [inspectGit(repo, now - 60_000, now - 59_000)]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
  });
}

test('an in-flight tmp pack is not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const t_start = Date.now();
  writeFileSync(join(repo, '.git', 'objects', 'pack', 'tmp_pack_abc123'), 'x');
  writeFileSync(join(repo, '.git', 'objects', 'pack', 'tmp_pack_def456.promisor'), 'x');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_paths, []);
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

// A partial clone by default: the only kind of repo a lazy fetch can write to.
function gitRepo(execFileSync, { partial = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'si-verify-user-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  const g = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: 'ignore' });
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'one');
  if (partial) g('config', 'remote.origin.promisor', 'true');
  return { repo, g };
}

test('a loose object written inside an inspect git run in a partial clone is reported, not blamed', async () => {
  const { execFileSync } = await import('node:child_process');
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const t_start = Date.now();
  mkdirSync(join(repo, '.git', 'objects', 'ab'), { recursive: true });
  writeFileSync(join(repo, '.git', 'objects', 'ab', 'cdef'), 'x');
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

// A commit in a sibling worktree writes objects into the shared store while inspect
// runs git in this one: the user's write, not a lazy fetch.
for (const partial of [true, false]) {
  test(`a commit in a sibling worktree during an inspect git run is reported, not blamed (${partial ? 'partial' : 'full'} clone)`, async () => {
    const { execFileSync } = await import('node:child_process');
    const { repo, g } = gitRepo(execFileSync, { partial });
    const wt = `${repo}-wt`;
    g('worktree', 'add', '-q', wt);
    const { heads } = baselineOf([], [repo]);
    const t_start = Date.now();
    writeFileSync(join(wt, 'n.txt'), 'n');
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
    for (const a of [['add', 'n.txt'], ['commit', '-q', '-m', 'n']]) execFileSync('git', a, { cwd: wt, env, stdio: 'ignore' });
    const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, Date.now())]);
    rmSync(wt, { recursive: true, force: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.changed_paths, []);
    assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
  });
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

// Coarse filesystems truncate mtimes: HFS+, NFS, and some ext4 to 1s; FAT and exFAT to 2s.
// A pack written during a run that starts late in a second still has to be blamed.
test('a lazy fetch on a coarse-mtime filesystem is blamed on inspect wherever the run starts in the second', async () => {
  const { execFileSync } = await import('node:child_process');
  const { utimesSync } = await import('node:fs');
  const S = 1_700_000_000_000; // an even second
  for (const [label, mtime, runSecond] of [['1s', S + 1000, S + 1000], ['2s', S, S + 1000]]) {
    for (const off of [100, 400, 700]) {
      const { repo } = gitRepo(execFileSync);
      const { heads } = baselineOf([], [repo]);
      const pack = join(repo, '.git', 'objects', 'pack');
      for (const ext of ['pack', 'promisor']) {
        writeFileSync(join(pack, `pack-0000.${ext}`), 'x');
        utimesSync(join(pack, `pack-0000.${ext}`), mtime / 1000, mtime / 1000);
      }
      const t_start = runSecond + off;
      const r = verifyRun({ files: [], heads }, [inspectGit(repo, t_start, t_start + 20)]);
      assert.equal(r.ok, false, `${label} truncation, run +${off}ms into the second`);
    }
  }
});

test('a whole-second promisor pack from before the run window is not blamed on inspect', async () => {
  const { execFileSync } = await import('node:child_process');
  const { utimesSync } = await import('node:fs');
  const S = 1_700_000_000_000;
  const { repo } = gitRepo(execFileSync);
  const { heads } = baselineOf([], [repo]);
  const pack = join(repo, '.git', 'objects', 'pack');
  for (const ext of ['pack', 'promisor']) {
    writeFileSync(join(pack, `pack-0000.${ext}`), 'x');
    utimesSync(join(pack, `pack-0000.${ext}`), S / 1000, S / 1000);
  }
  const r = verifyRun({ files: [], heads }, [inspectGit(repo, S + 2500, S + 2600)]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.change), ['.git changed']);
});

// Real git: a tree:0 clone whose repo config names a local bundle. With the lazy-fetch
// and bundle guards stripped (old git, or a future bypass) the unbundled pack has no
// .promisor sidecar; verify must still blame the run it landed in.
test('a real bundle-URI pack written during an unguarded git run fails the run', async (t) => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  // fetch.bundleURI arrived in git 2.40; older git has nothing to unbundle.
  const [maj, min] = (execFileSync('git', ['--version'], { encoding: 'utf8' }).match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  if (maj < 2 || (maj === 2 && min < 40)) return t.skip(`git ${maj}.${min} has no fetch.bundleURI`);
  const { gitInvocation } = await import('../../src/io/git.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'si-verify-bundle-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, stdio: 'ignore' });
  try {
    g(dir, 'init', '-q', 'src');
    for (const v of ['one', 'two']) {
      writeFileSync(join(dir, 'src', 'a.txt'), v);
      g(join(dir, 'src'), 'add', 'a.txt');
      g(join(dir, 'src'), 'commit', '-q', '-m', v);
    }
    g(join(dir, 'src'), 'config', 'uploadpack.allowFilter', 'true');
    g(join(dir, 'src'), 'bundle', 'create', join(dir, 'all.bundle'), '--all');
    g(dir, 'clone', '-q', '--filter=tree:0', '--no-local', `file://${join(dir, 'src')}`, 'clone');
    const clone = join(dir, 'clone');
    g(clone, 'config', 'fetch.bundleURI', join(dir, 'all.bundle'));
    const { heads } = baselineOf([], [clone]);
    const inv = gitInvocation(['log', '-1', '--format=%cI', '--', 'a.txt'], clone);
    delete inv.env.GIT_NO_LAZY_FETCH;
    const args = inv.args.filter((a, i) => !/bundleURI/.test(a) && !/bundleURI/.test(inv.args[i + 1] ?? ''));
    const t_start = Date.now();
    spawnSync(inv.cmd, args, { cwd: clone, env: inv.env, stdio: 'pipe' });
    const r = verifyRun({ files: [], heads }, [inspectGit(clone, t_start, Date.now())]);
    assert.equal(r.ok, false, 'control: the stripped run must write a pack');
    assert.deepEqual(r.changed_paths, [join(clone, '.git')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a judge launch of the harness command is allowed; any other spawn fails the run', () => {
  const { base } = setup();
  const judge = { op: 'spawn', cmd: '/opt/bin/claude', args: ['--print'], mode: 'x', judge: true };
  assert.equal(verifyRun(base, [judge]).ok, true, 'the armed judge command (not this Node) is no stray spawn');
  assert.equal(verifyRun(base, [{ ...judge, judge: undefined }]).ok, false);
  assert.equal(verifyRun(base, [{ op: 'spawn', cmd: '/bin/sh', args: ['-c', 'x'], mode: 'x' }]).ok, false);
});
