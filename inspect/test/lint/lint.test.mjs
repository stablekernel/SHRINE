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

test('lint-network fails on an import split over several lines', () => {
  const r = lint('lint-network.mjs', join(here, 'network-multiline'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /network module node:https/);
  assert.match(r.stdout, /network global fetch/);
});

test('lint-network fails on a global or module reached by a computed name', () => {
  const r = lint('lint-network.mjs', join(here, 'network-computed'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /bad\.mjs:2: global object globalThis/);
  assert.match(r.stdout, /module loaded by a computed name/);
  assert.match(r.stdout, /bad\.mjs:4: network global fetch/);
  assert.match(r.stdout, /dynamic code or reflection Reflect/);
  assert.match(r.stdout, /bad\.mjs:6: global object globalThis/);
  assert.match(r.stdout, /req\.mjs:2: createRequire reached/);
  assert.match(r.stdout, /bi\.mjs:1: getBuiltinModule reached/);
});

test('lint-network fails on any bare network global, not only a call', () => {
  const r = lint('lint-network.mjs', join(here, 'network-bare'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const line of [1, 2, 3, 8]) assert.match(r.stdout, new RegExp(`bad\\.mjs:${line}: network global fetch`));
  assert.match(r.stdout, /bad\.mjs:4: process used other than by a named property/);
  assert.match(r.stdout, /bad\.mjs:5: sendBeacon reached/);
  assert.match(r.stdout, /bad\.mjs:5: global object navigator/);
  assert.match(r.stdout, /bad\.mjs:6: constructor reached/);
  assert.match(r.stdout, /bad\.mjs:7: process used other than by a named property/);
});

test('lint-network reads code with a real parser: slashes, escapes, and prototype routes', () => {
  const r = lint('lint-network.mjs', join(here, 'network-parse'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const line of [1, 2, 3, 4]) assert.match(r.stdout, new RegExp(`bad\\.mjs:${line}: network global fetch`));
  assert.match(r.stdout, /bad\.mjs:5: global object globalThis/);
  assert.match(r.stdout, /bad\.mjs:6: constructor reached/);
  assert.match(r.stdout, /bad\.mjs:7: getPrototypeOf reached/);
  assert.match(r.stdout, /bad\.mjs:8: property name built at run time/);
  assert.match(r.stdout, /bad\.mjs:9: import from outside src and bin/);
  assert.match(r.stdout, /bad\.mjs:10: execve reached/);
  assert.match(r.stdout, /bad\.mjs:11: constructor reached/);
  assert.match(r.stdout, /bad\.mjs:12: constructor reached/);
  assert.match(r.stdout, /bad\.mjs:13: property name built at run time/);
  assert.match(r.stdout, /bad\.mjs:14: property name built at run time/);
});

test('lint-network allows only node: built-ins and files inside src and bin', () => {
  const r = lint('lint-network.mjs', join(here, 'network-imports'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  for (const line of [1, 2, 3, 4, 5]) assert.match(r.stdout, new RegExp(`bad\\.mjs:${line}: import of code this lint does not read`));
  assert.match(r.stdout, /bad\.mjs:6: network module node:inspector\/promises/);
  assert.match(r.stdout, /bad\.mjs:7: network module node:process/);
  assert.match(r.stdout, /bad\.mjs:8: network module node:cluster/);
  assert.doesNotMatch(r.stdout, /bad\.mjs:9:/, 'a file named ..x.mjs is inside src');
});

test('lint-network passes literal imports, property access, and names in strings or comments', () => {
  const r = lint('lint-network.mjs', join(here, 'network-clean'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
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
