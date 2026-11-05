import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));
const STUB = fileURLToPath(new URL('./no-network.cjs', import.meta.url));

test('a full T0 run completes with sockets and DNS stubbed to throw', () => {
  const h = makeHome('bad');
  const state = mkdtempSync(join(tmpdir(), 'si-net-'));
  const r = spawnSync(process.execPath, [BIN, 'run', '--tier', 'T0', '--no-history', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--require "${STUB}"`,
      HOME: h.home,
      SHRINE_INSPECT_STATE_DIR: join(state, 'state'),
      SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'),
      SHRINE_INSPECT_NOW: FIXED_NOW,
      SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).report.endsWith('report.html'));
  h.cleanup();
});
