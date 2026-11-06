import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..', '..');

function lint(script, root) {
  const args = [join(pkgRoot, 'scripts', script)];
  if (root) args.push('--root', root);
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('lint-readonly fails on a write API outside the run-folder writer', () => {
  const r = lint('lint-readonly.mjs', join(here, 'readonly'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /writeFileSync/);
});

test('lint-copy fails on an em dash in copy', () => {
  const r = lint('lint-copy.mjs', join(here, 'copy'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /em dash/);
});

test('lint-network fails on an http import', () => {
  const r = lint('lint-network.mjs', join(here, 'network'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /node:http/);
});

for (const script of ['lint-readonly.mjs', 'lint-copy.mjs', 'lint-network.mjs']) {
  test(`${script} passes on the package itself`, () => {
    const r = lint(script);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

test('lint-network fails on an environment or key read in judge code', () => {
  const r = lint('lint-network.mjs', join(here, 'judge'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /environment read in judge code/);
  assert.match(r.stdout, /key variable ANTHROPIC_API_KEY/);
});
