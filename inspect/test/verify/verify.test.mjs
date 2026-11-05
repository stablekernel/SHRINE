import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineOf, verifyRun } from '../../src/verify/verify.mjs';

function item(path) {
  const s = statSync(path);
  return { path, bytes: s.size, mtime_ms: s.mtimeMs, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'si-verify-'));
  const cfg = join(dir, 'settings.json');
  const log = join(dir, 'session.jsonl');
  writeFileSync(cfg, '{"a":1}');
  writeFileSync(log, '{"type":"user"}\n');
  return { cfg, log, base: baselineOf([item(cfg), item(log)]) };
}

test('unchanged files verify ok', () => {
  const { base } = setup();
  const r = verifyRun(base, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_paths, []);
  assert.equal(r.files_checked, 2);
});

test('a config file changed with a write open by inspect fails the run', () => {
  const { cfg, base } = setup();
  writeFileSync(cfg, '{"a":2,"b":3}');
  const r = verifyRun(base, [{ op: 'write', path: cfg, mode: 'w', t: 1 }]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.changed_paths, [cfg]);
});

test('a change with no write open is "changed during run, not by inspect"', () => {
  const { cfg, base } = setup();
  writeFileSync(cfg, '{"a":2,"b":3}');
  const r = verifyRun(base, [{ op: 'open', path: cfg, mode: 'r', t: 1 }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed_by_others.map((c) => c.note), ['changed during run, not by inspect']);
});

test('session log growth is attributed to other sessions, never a failure', () => {
  const { log, base } = setup();
  writeFileSync(log, '{"type":"user"}\n{"type":"assistant"}\n');
  const r = verifyRun(base, []);
  assert.equal(r.ok, true);
  assert.equal(r.changed_by_others[0].change, 'grew');
});

test('a non-allowlisted spawn in the spy log fails verification', () => {
  const { base } = setup();
  assert.equal(verifyRun(base, [{ op: 'spawn', cmd: 'sh', args: [] }]).ok, false);
});
