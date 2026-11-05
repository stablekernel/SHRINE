import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeHome } from '../../synth/home.mjs';
import { detect } from '../../../src/adapters/claude-code/detect.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inventory, nestedInstructionFiles } from '../../../src/adapters/claude-code/inventory.mjs';
import { retention } from '../../../src/adapters/claude-code/retention.mjs';
import { alwaysLoaded, resolveImports } from '../../../src/adapters/claude-code/always-loaded.mjs';
import { resetSpy, spyLog } from '../../../src/io/fsread.mjs';
import { growth, repeatTo } from '../../synth/growth.mjs';

beforeEach(() => resetSpy());

const count = (items, kind) => items.filter((i) => i.kind === kind).length;

test('detect finds ~/.claude without reading session content or spawning', () => {
  const h = makeHome('good');
  const d = detect({ home: h.home });
  assert.equal(d.present, true);
  assert.equal(d.name, 'Claude Code');
  assert.equal(d.version, null);
  assert.equal(d.version_note, 'not read');
  assert.equal(d.claude_home, h.claudeHome);
  const log = spyLog();
  assert.equal(log.filter((e) => e.op === 'spawn').length, 0);
  assert.equal(log.filter((e) => e.op === 'open' && e.path.endsWith('.jsonl')).length, 0);
  assert.equal(detect({ home: join(h.tmp, 'nobody') }).present, false);
  h.cleanup();
});

test('inventory lists every source with path, size, mtime, sha256, and source', () => {
  const h = makeHome('good');
  const inv = inventory({ home: h.home, projects: h.projects, managedPath: null });
  const paths = inv.items.map((i) => i.path);
  for (const p of [
    join(h.claudeHome, 'settings.json'),
    join(h.claudeHome, 'CLAUDE.md'),
    join(h.claudeHome, 'extra.md'),
    join(h.claudeHome, 'rules', 'style.md'),
    join(h.claudeHome, 'output-styles', 'terse.md'),
    join(h.claudeHome, 'agents', 'reviewer.md'),
    join(h.claudeHome, 'commands', 'ship.md'),
    join(h.claudeHome, 'skills', 'review', 'SKILL.md'),
    join(h.repo, 'CLAUDE.md'),
    join(h.repo, '.claude', 'settings.json'),
  ]) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  const files = inv.items.filter((x) => !x.virtual);
  assert.ok(files.length > 0, 'inventory lists files');
  for (const i of files) {
    assert.equal(typeof i.bytes, 'number', i.path);
    assert.match(i.mtime, /^\d{4}-/, i.path);
    assert.match(i.sha256, /^[0-9a-f]{64}$/, i.path);
    assert.ok(['user', 'project', 'local', 'plugin', 'managed'].includes(i.source), i.path);
  }
  assert.equal(count(inv.items, 'hook'), 1);
  assert.equal(count(inv.items, 'skill'), 1, 'own shrine-inspect skill excluded');
  assert.equal(count(inv.items, 'memory'), 1);
  assert.ok(!paths.some((p) => p.includes('shrine-inspect')));
  h.cleanup();
});

test('inventory collects permissions and modes from every settings layer', () => {
  const h = makeHome('bad');
  const inv = inventory({ home: h.home, projects: h.projects, managedPath: null });
  assert.deepEqual(inv.permissions.allow.map((a) => a.rule).sort(), ['Bash', 'Edit(*)', 'Write']);
  assert.equal(inv.permissions.defaultMode.value, 'bypassPermissions');
  assert.equal(inv.permissions.skipDangerousModePermissionPrompt.value, true);
  h.cleanup();
});

test('a plugin-shipped hook counts as a hook from source plugin', () => {
  const h = makeHome('plugin');
  const inv = inventory({ home: h.home, projects: h.projects, managedPath: null });
  const hooks = inv.items.filter((i) => i.kind === 'hook');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].source, 'plugin');
  assert.equal(hooks[0].loaded_by, 'plugin:guard@market');
  assert.equal(count(inv.items, 'skill'), 0, 'only the own skill is installed, so no skills');
  h.cleanup();
});

test('nested CLAUDE.md files are found only inside a repo, never under the home folder or nested repos', () => {
  const h = makeHome('good');
  mkdirSync(join(h.repo, 'api'), { recursive: true });
  writeFileSync(join(h.repo, 'api', 'CLAUDE.md'), 'Owner: t\n');
  mkdirSync(join(h.repo, 'vendored', '.git'), { recursive: true });
  writeFileSync(join(h.repo, 'vendored', 'CLAUDE.md'), 'x');
  assert.deepEqual(nestedInstructionFiles(h.repo, h.home), [join(h.repo, 'api', 'CLAUDE.md')]);
  mkdirSync(join(h.home, 'src'), { recursive: true });
  writeFileSync(join(h.home, 'src', 'CLAUDE.md'), 'x');
  assert.deepEqual(nestedInstructionFiles(h.home, h.home), []);
  h.cleanup();
});

test('retention reads cleanupPeriodDays, else 30', () => {
  const good = makeHome('good');
  const bad = makeHome('bad');
  assert.deepEqual(retention({ home: good.home }), { days: 90, source: 'settings' });
  assert.deepEqual(retention({ home: bad.home }), { days: 30, source: 'default' });
  good.cleanup();
  bad.cleanup();
});

test('always-loaded covers CLAUDE.md chain with imports, rules, output style, MEMORY.md; not skills or agents', () => {
  const h = makeHome('good');
  const inv = inventory({ home: h.home, projects: h.projects, managedPath: null });
  const al = alwaysLoaded({ home: h.home, projects: h.projects, inventory: inv });
  const files = al.by_project[0].files.map((f) => f.path);
  for (const p of [
    join(h.claudeHome, 'CLAUDE.md'),
    join(h.claudeHome, 'extra.md'),
    join(h.claudeHome, 'rules', 'style.md'),
    join(h.claudeHome, 'output-styles', 'terse.md'),
    join(h.repo, 'CLAUDE.md'),
  ]) {
    assert.ok(files.includes(p), `missing ${p}`);
  }
  assert.ok(files.some((p) => p.endsWith(join('memory', 'MEMORY.md'))));
  assert.ok(!files.some((p) => p.includes('skills') || p.includes('agents')));
  assert.equal(al.max_bytes, al.by_project[0].bytes);
  h.cleanup();
});

test('oversized always-loaded fixture exceeds 40 KB', () => {
  const h = makeHome('bad');
  const inv = inventory({ home: h.home, projects: h.projects, managedPath: null });
  assert.ok(alwaysLoaded({ home: h.home, projects: h.projects, inventory: inv }).max_bytes > 40 * 1024);
  h.cleanup();
});

test('imports resolve relative, home, and nested paths once, ignoring code and emails', () => {
  const text = 'See @extra.md and @~/x.md\n`@not-this.md`\nmail me@host.com\n```\n@fenced.md\n```\n';
  assert.deepEqual(resolveImports(text, '/a/b', '/h'), ['/a/b/extra.md', '/h/x.md']);
});

test('org names from remotes take every path segment between host and repo', async () => {
  const { remoteOrgs } = await import('../../../src/adapters/claude-code/setup.mjs');
  assert.deepEqual(remoteOrgs('git@gitlab.com:topgroup/sub/repo.git'), ['topgroup', 'sub']);
  assert.deepEqual(remoteOrgs('https://dev.azure.com/acmeorg/proj/_git/repo'), ['acmeorg', 'proj']);
  assert.deepEqual(remoteOrgs('git@ssh.dev.azure.com:v3/acmeorg/proj/repo'), ['acmeorg', 'proj']);
  assert.deepEqual(remoteOrgs('https://ci@github.com:443/acme-corp/shop-api.git'), ['acme-corp']);
  assert.deepEqual(remoteOrgs('ssh://git@host.example/a/b/c/repo'), ['a', 'b', 'c']);
  assert.deepEqual(remoteOrgs('/srv/git/repo.git'), []);
});

test('remote urls come from url lines in a git config', async () => {
  const { remoteUrls } = await import('../../../src/adapters/claude-code/setup.mjs');
  const cfg = '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/app.git\n  url=https://x/y/z  \n# url = nope here\n';
  assert.deepEqual(remoteUrls(cfg), ['git@github.com:acme/app.git', 'https://x/y/z']);
});

test('import and remote-url parsing run in linear time on adversarial files', async () => {
  const { remoteUrls } = await import('../../../src/adapters/claude-code/setup.mjs');
  const cases = [
    [(n) => `@a${'.'.repeat(n)}a`, (s) => resolveImports(s, '/a', '/h')],
    [(n) => `@${'a.'.repeat(n / 2)}`, (s) => resolveImports(s, '/a', '/h')],
    [repeatTo('\n'), remoteUrls],
    [repeatTo(' \n\t'), remoteUrls],
    [repeatTo('url = x '), remoteUrls],
  ];
  for (const [build, run] of cases) {
    const g = growth(build, run);
    assert.ok(g < 10, `4x input took ${g.toFixed(1)}x as long`);
  }
});

test('with git history skipped, the git config user is still masked as an author', async () => {
  const { execFileSync } = await import('node:child_process');
  const { knownIdentifiers, configUser } = await import('../../../src/adapters/claude-code/setup.mjs');
  const { setGitVersion, historyReadable } = await import('../../../src/io/git.mjs');
  const { buildIdentifiers, mask } = await import('../../../src/scrub/mask.mjs');
  const h = makeHome('good');
  const name = 'Peter Gibbons';
  const email = 'peter@initech.example';
  const g = (...a) => execFileSync('git', a, { cwd: h.repo, stdio: 'ignore' });
  g('config', 'remote.origin.promisor', 'true');
  g('config', 'user.name', name);
  g('config', 'user.email', email);
  writeFileSync(join(h.home, '.gitconfig'), '[user]\n\tname = "Milton W"\n\temail = milton@initech.example\n');
  setGitVersion([2, 44, 0]);
  try {
    assert.equal(historyReadable(h.repo), false, 'control: history is skipped');
    const ids = knownIdentifiers({ home: h.home, projects: [{ root: h.repo }] });
    assert.ok(ids.authors.some((a) => a.name === name && a.email === email), JSON.stringify(ids.authors));
    assert.ok(ids.authors.some((a) => a.name === 'Milton W'), 'the global git config user too');
    const out = mask(`Owner: ${name} <${email}>, reviewed by Milton W`, buildIdentifiers(ids));
    assert.doesNotMatch(out, /Peter|Gibbons|peter@|Milton/, out);
  } finally {
    setGitVersion(undefined);
    h.cleanup();
  }
  assert.equal(configUser('[core]\n\tname = x\n'), null);
  assert.deepEqual(configUser('[user]\n  email = a@b.example\n[user "x"]\n'), { name: null, email: 'a@b.example' });
});

// Git refuses a repo owned by another user. That is a failed read: the git date is
// unknown, so the file is marked like a skipped history read, not dated by mtime.
test('a repo git refuses to read gives unknown dates, not file times', async () => {
  const { collectSetup } = await import('../../../src/adapters/claude-code/setup.mjs');
  const { gitRefusals, resetGitTimeouts, setGitTestEnv } = await import('../../../src/io/git.mjs');
  const h = makeHome('good');
  const repoFile = (s) => s.items.find((i) => i.path === join(h.repo, 'CLAUDE.md'));
  try {
    const control = collectSetup({ home: h.home, projects: h.projects, now: Date.now() });
    assert.equal(repoFile(control).last_change.source, 'git', 'control: a readable repo gives a git date');
    resetGitTimeouts();
    setGitTestEnv({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' });
    const s = collectSetup({ home: h.home, projects: h.projects, now: Date.now() });
    assert.equal(repoFile(s).last_change.git_skipped, true, JSON.stringify(repoFile(s).last_change));
    assert.deepEqual(gitRefusals(), [h.repo]);
    const user = s.items.find((i) => i.path === join(h.claudeHome, 'CLAUDE.md'));
    assert.ok(!user.last_change.git_skipped, 'a file outside any repo keeps its file time');
  } finally {
    setGitTestEnv();
    resetGitTimeouts();
    h.cleanup();
  }
});

// A linked worktree or a submodule has a .git file, not a folder: org names come
// from the config in the git dir it names (and that dir's commondir).
test('org names are read for linked worktrees and submodules too', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { knownIdentifiers } = await import('../../../src/adapters/claude-code/setup.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'si-orgs-'));
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b.example', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b.example' } });
  try {
    const main = join(dir, 'main');
    mkdirSync(main);
    g(main, 'init', '-q');
    g(main, 'commit', '-q', '--allow-empty', '-m', 'i');
    g(main, 'remote', 'add', 'origin', 'git@github.com:initrode-org/app.git');
    const wt = join(dir, 'wt');
    g(main, 'worktree', 'add', '-q', wt);
    const sub = join(main, 'vendor', 'lib');
    mkdirSync(join(main, 'vendor'));
    mkdirSync(join(main, '.git', 'modules'));
    g(main, 'init', '-q', `--separate-git-dir=${join(main, '.git', 'modules', 'lib')}`, sub);
    g(sub, 'remote', 'add', 'origin', 'https://gitlab.example/penetrode-group/lib.git');
    const orgs = (root) => knownIdentifiers({ home: null, projects: [{ root }] }).orgs;
    assert.deepEqual(orgs(main), ['initrode-org'], 'control: a plain repo');
    assert.deepEqual(orgs(wt), ['initrode-org'], 'a linked worktree reads the main config');
    assert.deepEqual(orgs(sub), ['penetrode-group'], 'a submodule reads its own git dir config');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
