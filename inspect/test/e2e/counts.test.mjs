// One unit, one number: the inventory count of instruction files is the same
// total the owner and review check reports, and output styles are counted apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

test('instruction files: the inventory total matches the owner and review check; output styles are apart', async () => {
  const h = makeHome('good', { projectName: 'app' });
  const state = mkdtempSync(join(tmpdir(), 'si-counts-'));
  const out = [];
  const err = [];
  const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
    env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    home: h.home,
    stdin: { isTTY: false },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  h.cleanup();
  assert.equal(code, 0, err.join(''));
  const s = JSON.parse(out.join(''));
  const scan = JSON.parse(readFileSync(join(s.run_dir, 'scan.json'), 'utf8'));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const owner = scan.probes.find((p) => p.kind === 'no_owner_or_review');
  const inv = Object.fromEntries(findings.configured.map((c) => [c.item, c.count]));
  assert.ok(inv['output styles'] >= 1, 'the fixture has an output style');
  assert.equal(inv['instruction files'], owner.metric.total);
});
