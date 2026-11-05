import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitInvocation, historyReadable, honorsNoLazyFetch, setGitVersion } from '../../src/io/git.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, stdio: 'pipe' }).toString();
const packs = (repo) => readdirSync(join(repo, '.git', 'objects', 'pack')).filter((f) => f.endsWith('.pack'));

function partialClone(filter = 'blob:none') {
  const dir = mkdtempSync(join(tmpdir(), 'si-lazy-'));
  const src = join(dir, 'src');
  sh(dir, 'init', '-q', src);
  writeFileSync(join(src, 'a.txt'), 'one\n');
  sh(src, 'add', 'a.txt');
  sh(src, 'commit', '-q', '-m', 'one');
  writeFileSync(join(src, 'a.txt'), 'two\n');
  sh(src, 'commit', '-q', '-am', 'two');
  const bare = join(dir, 'bare.git');
  sh(dir, 'clone', '-q', '--bare', src, bare);
  sh(bare, 'config', 'uploadpack.allowFilter', 'true');
  const clone = join(dir, 'clone');
  sh(dir, 'clone', '-q', `--filter=${filter}`, '--no-local', `file://${bare}`, clone);
  return clone;
}

// On git that ignores GIT_NO_LAZY_FETCH, git() skips history reads in a partial
// clone and never runs git, so a test through it would pass with every guard gone.
// Claim a trusted version so git really runs; on old git the transport guards then
// carry the test alone.
function gitRuns(args, cwd) {
  setGitVersion([2, 45, 1]);
  try {
    const r = git(args, { cwd });
    assert.notEqual(r.skipped, true, 'git did not run');
    return r;
  } finally {
    setGitVersion(undefined);
  }
}

test('git never lazy-fetches missing objects from a promisor remote', () => {
  const clone = partialClone();
  try {
    const before = packs(clone);
    const r = gitRuns(['show', 'HEAD~1:a.txt'], clone);
    assert.equal(r.ok, false, 'old blob must stay missing');
    assert.deepEqual(packs(clone), before);
  } finally {
    rmSync(join(clone, '..'), { recursive: true, force: true });
  }
});

// A tree:0 partial clone whose repo config re-enables a transport and points the
// promisor remote at a script. The script only touches a marker inside the temp dir.
function trappedClone(kind) {
  const clone = partialClone('tree:0');
  const dir = join(clone, '..');
  const marker = join(dir, 'PWNED');
  const script = join(dir, 'trap.sh');
  writeFileSync(script, `touch '${marker}'\nexit 1\n`);
  if (kind === 'ext') {
    sh(clone, 'config', 'protocol.ext.allow', 'always');
    sh(clone, 'config', 'remote.origin.url', `ext::sh ${script}`);
  } else {
    sh(clone, 'config', 'protocol.file.allow', 'always');
    sh(clone, 'config', 'remote.origin.uploadpack', `sh ${script} #`);
  }
  return { dir, clone, marker };
}

// The linker's history walk plus a per-file lookup: both need trees a tree:0 clone lacks.
const LAZY_READS = [['log', '--all', '--no-renames', '--name-only', '--format=%H'], ['log', '-1', '--format=%H', '--', 'a.txt']];

for (const kind of ['ext', 'file']) {
  test(`repo config cannot re-enable the ${kind} transport for a lazy fetch`, () => {
    const { dir, clone, marker } = trappedClone(kind);
    try {
      for (const args of LAZY_READS) gitRuns(args, clone);
      assert.equal(existsSync(marker), false, 'inspect git ran the remote command');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Git before 2.44.1 / 2.45.1 ignores GIT_NO_LAZY_FETCH, so drop it to act like that git.
  test(`repo config cannot re-enable the ${kind} transport, for git older than GIT_NO_LAZY_FETCH`, () => {
    const { dir, clone, marker } = trappedClone(kind);
    try {
      for (const args of LAZY_READS) {
        const inv = gitInvocation(args, clone);
        delete inv.env.GIT_NO_LAZY_FETCH;
        spawnSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env, stdio: 'pipe' });
      }
      assert.equal(existsSync(marker), false, 'inspect git ran the remote command');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// fetch.bundleURI is applied by the lazy fetch before any transport check, so a
// local bundle named in repo config writes a pack even with every protocol refused.
test('repo config fetch.bundleURI cannot write a pack, for git older than GIT_NO_LAZY_FETCH', () => {
  const clone = partialClone('tree:0');
  const dir = join(clone, '..');
  try {
    const bundle = join(dir, 'all.bundle');
    sh(join(dir, 'src'), 'bundle', 'create', bundle, '--all');
    sh(clone, 'config', 'fetch.bundleURI', bundle);
    const before = packs(clone);
    for (const args of [['log', '-1', '--format=%cI', '--', 'a.txt'], ...LAZY_READS]) {
      const inv = gitInvocation(args, clone);
      delete inv.env.GIT_NO_LAZY_FETCH;
      spawnSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env, stdio: 'pipe' });
    }
    assert.deepEqual(packs(clone), before, 'a lazy fetch applied the bundle');
    assert.equal(existsSync(join(clone, '.git', 'objects', 'bundles')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// GIT_ALLOW_PROTOCOL also allows remote helpers by name, so the value must not be
// a name a URL can carry (<scheme>::, scheme chars only).
test('the GIT_ALLOW_PROTOCOL value cannot name a remote helper', () => {
  const allow = gitInvocation(['log'], '.').env.GIT_ALLOW_PROTOCOL;
  for (const name of allow.split(':')) assert.doesNotMatch(name, /^[A-Za-z][A-Za-z0-9+.-]*$/);
  const clone = partialClone('tree:0');
  const dir = join(clone, '..');
  try {
    const bin = join(dir, 'bin');
    const marker = join(dir, 'PWNED');
    execFileSync('mkdir', [bin]);
    // A helper named after the old allow value, reached through a "none::" URL.
    writeFileSync(join(bin, 'git-remote-none'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
    sh(clone, 'config', 'remote.origin.url', 'none::x');
    for (const args of LAZY_READS) {
      const inv = gitInvocation(args, clone);
      delete inv.env.GIT_NO_LAZY_FETCH;
      inv.env.GIT_ALLOW_PROTOCOL = 'none';
      inv.env.PATH = `${bin}:${inv.env.PATH}`;
      spawnSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env, stdio: 'pipe' });
    }
    assert.equal(existsSync(marker), true, 'control: an allow value that names a helper runs it');
    rmSync(marker);
    for (const args of LAZY_READS) {
      const inv = gitInvocation(args, clone);
      delete inv.env.GIT_NO_LAZY_FETCH;
      inv.env.PATH = `${bin}:${inv.env.PATH}`;
      spawnSync(inv.cmd, inv.args, { cwd: inv.cwd, env: inv.env, stdio: 'pipe' });
    }
    assert.equal(existsSync(marker), false, 'inspect git ran the remote helper');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a GIT_* variable from the caller cannot redirect which repo git reads', async () => {
  const { repoRoot } = await import('../../src/adapters/claude-code/projects.mjs');
  const { realpathSync } = await import('node:fs');
  const mk = () => {
    const r = realpathSync(mkdtempSync(join(tmpdir(), 'si-env-')));
    sh(r, 'init', '-q');
    sh(r, 'commit', '-q', '--allow-empty', '-m', 'x');
    return r;
  };
  const a = mk();
  const b = mk();
  const saved = { ...process.env };
  Object.assign(process.env, { GIT_DIR: join(b, '.git'), GIT_WORK_TREE: b, GIT_INDEX_FILE: join(b, '.git', 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'cat', GIT_ALLOW_PROTOCOL: 'ext:file' });
  try {
    assert.equal(repoRoot(a), a);
    const env = gitInvocation(['log'], a).env;
    assert.equal(env.GIT_ALLOW_PROTOCOL, 'no_transport');
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_')).sort(), ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', ...(saved.GIT_CEILING_DIRECTORIES ? ['GIT_CEILING_DIRECTORIES'] : [])].sort());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});

test('GIT_NO_LAZY_FETCH is trusted only on git 2.44.1, 2.45.1, and later', () => {
  const cases = [[[2, 36, 6], false], [[2, 44, 0], false], [[2, 44, 1], true], [[2, 45, 0], false], [[2, 45, 1], true], [[2, 46, 0], true], [[3, 0, 0], true], [null, false]];
  for (const [v, want] of cases) assert.equal(honorsNoLazyFetch(v), want, String(v));
});

test('config is allowed only as the fixed promisor query, and --version only bare', () => {
  assert.throws(() => gitInvocation(['config', '--get', 'core.pager'], '.'), /allowlist/);
  assert.throws(() => gitInvocation(['config', 'core.pager', 'x'], '.'), /allowlist/);
  assert.throws(() => gitInvocation(['--version', '--build-options'], '.'), /allowlist/);
  assert.equal(gitInvocation(['--version'], '.').cmd, 'git');
});

test('a partial clone on git that ignores GIT_NO_LAZY_FETCH skips history reads; others run', () => {
  const clone = partialClone('tree:0');
  const dir = join(clone, '..');
  try {
    const bundle = join(dir, 'all.bundle');
    sh(join(dir, 'src'), 'bundle', 'create', bundle, '--all');
    sh(clone, 'config', 'fetch.bundleURI', bundle);
    const before = packs(clone);
    setGitVersion([2, 44, 0]);
    assert.equal(historyReadable(clone), false);
    const r = git(['log', '-1', '--format=%cI', '--', 'a.txt'], { cwd: clone });
    assert.equal(r.skipped, true);
    assert.equal(git(['rev-parse', 'HEAD'], { cwd: clone }).ok, true, 'ref reads still run');
    assert.deepEqual(packs(clone), before);
    assert.equal(historyReadable(join(dir, 'src')), true, 'a full clone keeps its history');
    assert.equal(git(['log', '-1', '--format=%H'], { cwd: join(dir, 'src') }).ok, true);
    setGitVersion([2, 45, 1]);
    assert.equal(historyReadable(clone), true);
  } finally {
    setGitVersion(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});
