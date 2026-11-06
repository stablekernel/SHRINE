import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory, nestedInstructionFiles } from '../../../src/adapters/claude-code/inventory.mjs';

function home(links) {
  const h = mkdtempSync(join(tmpdir(), 'si-loop-'));
  const rules = join(h, '.claude', 'rules');
  mkdirSync(join(rules, 'sub'), { recursive: true });
  writeFileSync(join(rules, 'a.md'), 'rule a\n');
  writeFileSync(join(rules, 'sub', 'b.md'), 'rule b\n');
  for (const l of links) symlinkSync('.', join(rules, l));
  return h;
}
const rules = (h) => inventory({ home: h, projects: [], managedPath: null }).items.filter((i) => i.path.includes('/rules/'));

test('a symlink back to its own folder adds no duplicate rule files', { timeout: 5000 }, () => {
  assert.equal(rules(home(['x'])).length, 2);
});

test('two self links neither hang nor multiply files', { timeout: 5000 }, () => {
  assert.equal(rules(home(['x', 'y'])).length, 2);
});

test('a symlinked folder outside the tree is still walked once', { timeout: 5000 }, () => {
  const h = home([]);
  const ext = mkdtempSync(join(tmpdir(), 'si-ext-'));
  writeFileSync(join(ext, 'c.md'), 'rule c\n');
  symlinkSync(ext, join(h, '.claude', 'rules', 'shared'));
  symlinkSync(ext, join(h, '.claude', 'rules', 'shared2'));
  assert.equal(rules(h).length, 3);
});

test('a symlink to an ancestor folder is not walked', { timeout: 5000 }, () => {
  const h = home([]);
  mkdirSync(join(h, '.claude', 'agents'));
  writeFileSync(join(h, '.claude', 'agents', 'z.md'), 'agent\n');
  symlinkSync('..', join(h, '.claude', 'rules', 'up'));
  assert.equal(rules(h).length, 2);
});

test('nested CLAUDE.md search does not follow a folder link out of the repo', { timeout: 5000 }, () => {
  const t = mkdtempSync(join(tmpdir(), 'si-nested-'));
  const repo = join(t, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'api'));
  writeFileSync(join(repo, 'api', 'CLAUDE.md'), 'api\n');
  mkdirSync(join(t, 'outside', 'private'), { recursive: true });
  writeFileSync(join(t, 'outside', 'private', 'CLAUDE.md'), 'private\n');
  symlinkSync('../outside', join(repo, 'linked'));
  symlinkSync('api', join(repo, 'api-again'));
  assert.deepEqual(nestedInstructionFiles(repo, join(t, 'home')), [join(repo, 'api', 'CLAUDE.md')]);
});
