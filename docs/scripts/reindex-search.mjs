// Rebuild the Pagefind index with the CLI after `astro build`, then verify it.
//
// Starlight runs Pagefind in service mode, which can ack writes before they reach
// disk and ship truncated files (Pagefind#1271). An empty pagefind.js broke search
// in production. The CLI flushes before exit. Keep the CLI rebuild until a Pagefind
// release includes the fix (Pagefind#1272).
//
// The check fails on any 0-byte file anywhere under dist/pagefind (fragment/, index/,
// wasm, worker). Truncation of non-empty files is detected only for pagefind.js.
//
// Usage: node scripts/reindex-search.mjs [--check-only]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = 'dist/pagefind';

if (!process.argv.includes('--check-only')) {
  // Hashed index files are skipped when present, so start clean.
  rmSync(out, { recursive: true, force: true });
  // Run the package's own bin with the current node, so npm/PATH are not needed.
  // package.json is not exported, so walk up from the resolved main entry (<pkg>/lib/index.js).
  let dir = dirname(fileURLToPath(import.meta.resolve('pagefind')));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  const bin = join(dir, JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).bin);
  execFileSync(process.execPath, [bin, '--site', 'dist'], { stdio: 'inherit' });
}

const fail = (msg) => {
  console.error(`[reindex-search] ${msg}`);
  process.exit(1);
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

let files;
try {
  files = walk(out);
} catch {
  fail(`${out} is missing`);
}
const empty = files.filter((f) => statSync(f).size === 0);
if (empty.length) fail(`empty files: ${empty.join(', ')}`);

// A truncated bundle loses its trailing export list; the UI then throws "options is not a function".
const js = readFileSync(join(out, 'pagefind.js'), 'utf8');
if (!/export\s*\{[^}]*\boptions\b[^}]*\}\s*;?\s*$/.test(js)) fail('pagefind.js is truncated');

console.log(`[reindex-search] ok: ${files.length} files`);
