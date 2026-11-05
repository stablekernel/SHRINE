import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));
const GIT_READ = new Set(['log', 'show', 'diff', 'rev-parse', 'status']);

// Hash of every path, mode, size, mtime, and content under a folder.
function treeHash(root) {
  const h = createHash('sha256');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const s = lstatSync(p);
      h.update(`${relative(root, p)}|${s.mode}|${s.size}|${s.mtimeMs}\n`);
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) h.update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest('hex');
}

test('fixture repo has git auto-maintenance off, so no detached git races the tree hash', () => {
  const h = makeHome('good');
  const get = (k) => spawnSync('git', ['config', '--get', k], { cwd: h.repo, encoding: 'utf8' }).stdout.trim();
  assert.equal(get('maintenance.auto'), 'false');
  assert.equal(get('gc.auto'), '0');
  h.cleanup();
});

for (const fixture of ['good', 'bad', 'plugin']) {
  test(`${fixture}: spy log shows no write outside the run folder, only read-only git; home byte-identical`, () => {
    const h = makeHome(fixture);
    const state = mkdtempSync(join(tmpdir(), 'si-ro-'));
    const before = treeHash(h.tmp);
    const r = spawnSync(process.execPath, [BIN, 'run', '--tier', 'T0', '--no-history', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(treeHash(h.tmp), before, 'fixture tree changed');
    const { run_dir } = JSON.parse(r.stdout);
    const spy = readFileSync(join(run_dir, 'spy.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const stateRoot = join(state, 'state');
    for (const op of ['open', 'write', 'spawn']) assert.ok(spy.some((e) => e.op === op), `spy log has ${op} entries`);
    for (const e of spy) {
      if (e.op === 'write') assert.ok(e.path.startsWith(stateRoot), `write outside state: ${e.path}`);
      if (e.op === 'open') assert.equal(e.mode, 'r', e.path);
      if (e.op === 'spawn') {
        assert.equal(e.cmd, 'git');
        const sub = e.args.find((a, i) => i > 0 && e.args[i - 1] !== '-c' && !a.startsWith('-'));
        assert.ok(GIT_READ.has(sub), `git ${sub}`);
      }
    }
    assert.ok(spy.some((e) => e.op === 'open'), 'spy log captured opens');
    const verify = JSON.parse(readFileSync(join(run_dir, 'verify.json'), 'utf8'));
    assert.equal(verify.ok, true);
    assert.ok(statSync(join(run_dir, 'verify.done')).isFile());
    h.cleanup();
  });
}
