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
  for (const i of inv.items.filter((x) => !x.virtual)) {
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
