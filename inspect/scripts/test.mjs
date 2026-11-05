// Finds every **/*.test.mjs under test/ and passes explicit paths to node --test,
// because directory and glob arguments differ between Node 20 and 22.
import { spawnSync } from 'node:child_process';
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
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: PKG_ROOT });
process.exit(r.status ?? 1);
