// Fixture for test/e2e/runner-limit.test.mjs, skipped in a normal run. With
// SHRINE_TEST_HANG_PIDFILE set, it starts a child of its own, writes the child's
// pid there, and blocks its event loop (as a git blocked in spawnSync would), so
// only the runner's run-wide limit can end it.
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const pidFile = process.env.SHRINE_TEST_HANG_PIDFILE;

test('blocks its event loop when asked (runner-limit fixture)', { skip: !pidFile }, () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
  writeFileSync(pidFile, String(child.pid));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120_000);
});
