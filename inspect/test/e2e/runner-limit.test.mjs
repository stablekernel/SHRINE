// The test runner's run-wide limit: past it, the whole test process group is
// killed and the run fails, never hangs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../../scripts/test.mjs', import.meta.url));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
};

test('the runner kills the whole test process group past its run-wide limit', { timeout: 60_000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('process groups are POSIX only');
  const dir = mkdtempSync(join(tmpdir(), 'si-runner-'));
  try {
    const pidFile = join(dir, 'pid');
    const t0 = Date.now();
    // NODE_TEST_CONTEXT would make the inner node --test report to this one instead.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const r = spawnSync(process.execPath, [RUNNER, 'fixtures/runner/hang'], {
      env: { ...env, SHRINE_TEST_TIMEOUT_MS: '3000', SHRINE_TEST_HANG_PIDFILE: pidFile },
      encoding: 'utf8',
      timeout: 50_000,
    });
    assert.notEqual(r.status, 0, 'the run fails');
    assert.match(r.stderr, /test run did not finish within 3 s; killed/);
    assert.ok(Date.now() - t0 < 30_000, 'ended by the limit, not by the fixture');
    const pid = Number(readFileSync(pidFile, 'utf8'));
    // The killed child is reparented and reaped; allow a moment for that.
    for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(alive(pid), false, 'a process the test started is killed with the group');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
