import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

test('package.json pins Node 20 or newer', () => {
  assert.equal(pkg.engines.node, '>=20');
});

test('package.json has no runtime dependencies', () => {
  assert.equal(pkg.dependencies, undefined);
});

test('package.json exposes the shrine-inspect bin', () => {
  assert.equal(pkg.bin['shrine-inspect'], 'bin/shrine-inspect.mjs');
});

test('package.json is an ES module package', () => {
  assert.equal(pkg.type, 'module');
});
