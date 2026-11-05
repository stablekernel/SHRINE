// Finds every **/*.test.mjs under test/ and passes explicit paths to node --test,
// because directory and glob arguments differ between Node 20 and 22.
// Tests get a private TMPDIR, removed afterwards, with git discovery capped at it,
// so a TMPDIR that sits inside a git checkout cannot change results or leave litter.
// User and system git config are ignored, so signing, hooks, or templates cannot leak in.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PKG_ROOT, walk } from './lib/walk.mjs';

const filter = process.argv.slice(2);
const files = walk(join(PKG_ROOT, 'test'), (f) => f.endsWith('.test.mjs')).filter(
  (f) => filter.length === 0 || filter.some((s) => f.includes(s)),
);
if (files.length === 0) {
  console.error('no test files found');
  process.exit(1);
}
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'si-test-')));
const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, GIT_CEILING_DIRECTORIES: tmp, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
// A child blocked in spawnSync (git on a pipe, if the spawn time limit ever broke)
// stops its event loop, so per-test timeouts never fire. The whole run has a limit
// too: past it, the test process group is killed and the run fails, never hangs.
const limitMs = Number(process.env.SHRINE_TEST_TIMEOUT_MS) || 10 * 60_000;
let status = 1;
try {
  const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: PKG_ROOT, env, detached: process.platform !== 'win32' });
  const timer = setTimeout(() => {
    console.error(`test run did not finish within ${limitMs / 1000} s; killed`);
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }, limitMs);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);
  status = signal ? 1 : (code ?? 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);
