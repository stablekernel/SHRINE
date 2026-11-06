// Release dry-run helpers (plan T3.5): the leak check catches each planted kind
// and ignores the page's own CSS; the tree hash sees adds, changes, and removes
// but not a folder that only leads to inspect's own; Node 20 is found through a
// version manager or reported as a gap. The full dry run is a CI job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNode20, hashTree, leaks, treeDiff } from '../../scripts/dry-run.mjs';

test('leak check: each planted kind is found; CSS and script are not the user name', () => {
  const needles = { secrets: ['abcdefghijklmnop'], paths: ['/x/fixture/home'], names: ['acme-billing'], prompts: ['Actually, use semicolons.'], user: 'root' };
  const page = (body) => `<html><style>:root { --bg: #fff }</style><script>var root = 1;</script><body>${body}</body></html>`;
  assert.deepEqual(leaks(page('<p>clean</p>'), needles), []);
  assert.deepEqual(leaks(page('<p>key abcdefghijklmnop</p>'), needles), ['secret: abcd...']);
  assert.deepEqual(leaks(page('<p>in /x/fixture/home</p>'), needles), ['path: /x/fixture/home']);
  assert.deepEqual(leaks(page('<p>acme-billing</p>'), needles), ['name: acme-billing']);
  assert.deepEqual(leaks(page('<p>Actually, use semicolons.</p>'), needles), ['prompt: Actually, use semicolons.']);
  assert.deepEqual(leaks(page('<p>owner root</p>'), needles), ['user name']);
  assert.deepEqual(leaks(page('<p>see /Users/someone/</p>'), needles), ['absolute path: /Users/someone/']);
});

test('tree hash: adds, changes, and removes show; a folder leading only to a skipped one does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'si-tree-'));
  mkdirSync(join(root, 'cfg'));
  writeFileSync(join(root, 'cfg', 'a.json'), '1');
  writeFileSync(join(root, 'b.md'), 'b');
  const own = join(root, 'Library', 'App', 'shrine-inspect');
  const a = hashTree(root, [own]);
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'state.json'), '{}');
  const b = hashTree(root, [own]);
  assert.equal(b.digest, a.digest, 'inspect-owned folder and its parents are not compared');
  writeFileSync(join(root, 'Library', 'other.txt'), 'x');
  writeFileSync(join(root, 'cfg', 'a.json'), '2');
  rmSync(join(root, 'b.md'));
  const c = hashTree(root, [own]);
  assert.deepEqual(treeDiff(a, c).sort(), ['added Library/other.txt', 'changed cfg/a.json', 'removed b.md']);
});

test('Node 20: found through nvm, fnm, or volta; otherwise a gap is reported', { skip: process.platform === 'win32' && 'POSIX' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'si-node-'));
  const none = findNode20({ execPath: '/nowhere/node', env: {}, home });
  assert.equal(none.node, '/nowhere/node');
  assert.match(none.gap, /no Node 20 found \(nvm, fnm, volta\)/);
  for (const [dir, rel] of [['.nvm/versions/node/v20.11.1', 'bin'], ['.volta/tools/image/node/20.11.1', 'bin'], ['.local/share/fnm/node-versions/v20.11.1', 'installation/bin']]) {
    const h = mkdtempSync(join(tmpdir(), 'si-node-'));
    const bin = join(h, dir, rel);
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'node'), '#!/bin/sh\necho v20.11.1\n');
    chmodSync(join(bin, 'node'), 0o755);
    // A newer non-20 install next to it is never picked.
    mkdirSync(join(h, dir.replace('20.11.1', '22.1.0'), rel), { recursive: true });
    const r = findNode20({ execPath: '/nowhere/node', env: {}, home: h });
    assert.equal(r.node, join(bin, 'node'), dir);
    assert.equal(r.gap, undefined);
  }
});

test('both CI dry runs make a missing Node 20 fatal on the Node 20 leg', () => {
  const wf = (name) => readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');
  const dryRun = (text) => text.split('\n').filter((l) => /node scripts\/dry-run\.mjs/.test(l));
  assert.ok(dryRun(wf('inspect.yml')).every((l) => /--require-node20/.test(l)));
  const release = dryRun(wf('inspect-release.yml'));
  assert.equal(release.length, 1);
  assert.match(release[0], /matrix\.node == 20 && '--require-node20'/);
});
