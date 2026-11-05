// Finds every **/*.test.mjs under test/ and passes explicit paths to node --test,
// because directory and glob arguments differ between Node 20 and 22.
// Tests get a private TMPDIR, removed afterwards, with git discovery capped at it,
// so a TMPDIR that sits inside a git checkout cannot change results or leave litter.
// User and system git config are ignored, so signing, hooks, or templates cannot leak in.
import { spawnSync } from 'node:child_process';
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
let status = 1;
try {
  const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: PKG_ROOT, env });
  status = r.status ?? 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);
