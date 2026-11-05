import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, gitInvocation } from '../../src/io/git.mjs';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, env: ENV, stdio: 'pipe' }).toString();
const packs = (repo) => readdirSync(join(repo, '.git', 'objects', 'pack')).filter((f) => f.endsWith('.pack'));

function partialClone() {
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
  sh(dir, 'clone', '-q', '--filter=blob:none', '--no-local', `file://${bare}`, clone);
  return clone;
}

test('git never lazy-fetches missing objects from a promisor remote', () => {
  const clone = partialClone();
  const before = packs(clone);
  const r = git(['show', 'HEAD~1:a.txt'], { cwd: clone });
  assert.equal(r.ok, false, 'old blob must stay missing');
  assert.deepEqual(packs(clone), before);
});

test('every transport is refused, for git older than GIT_NO_LAZY_FETCH', () => {
  const inv = gitInvocation(['log', '-1'], tmpdir());
  assert.equal(inv.env.GIT_NO_LAZY_FETCH, '1');
  assert.ok(inv.args.join(' ').includes('-c protocol.allow=never'));
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
  Object.assign(process.env, { GIT_DIR: join(b, '.git'), GIT_WORK_TREE: b, GIT_INDEX_FILE: join(b, '.git', 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'cat' });
  try {
    assert.equal(repoRoot(a), a);
    const env = gitInvocation(['log'], a).env;
    assert.deepEqual(Object.keys(env).filter((k) => k.startsWith('GIT_')).sort(), ['GIT_NO_LAZY_FETCH', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', ...(saved.GIT_CEILING_DIRECTORIES ? ['GIT_CEILING_DIRECTORIES'] : [])].sort());
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});
