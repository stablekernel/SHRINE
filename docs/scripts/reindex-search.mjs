// Rebuild the Pagefind index with the CLI after `astro build`, then verify it.
//
// Starlight runs Pagefind in service mode, which can ack writes before they reach
// disk and ship truncated files (Pagefind#1271). An empty pagefind.js broke search
// in production. The CLI flushes before exit. Drop the rebuild once a Pagefind
// release after 1.5.2 includes the fix (Pagefind#1272); keep the check.
//
// Usage: node scripts/reindex-search.mjs [--check-only]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist/pagefind';

if (!process.argv.includes('--check-only')) {
  // Hashed index files are skipped when present, so start clean.
  rmSync(out, { recursive: true, force: true });
  execFileSync('pagefind', ['--site', 'dist'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const fail = (msg) => {
  console.error(`[reindex-search] ${msg}`);
  process.exit(1);
};

let files;
try {
  files = readdirSync(out).filter((f) => statSync(join(out, f)).isFile());
} catch {
  fail(`${out} is missing`);
}
const empty = files.filter((f) => statSync(join(out, f)).size === 0);
if (empty.length) fail(`empty files: ${empty.join(', ')}`);

// A truncated bundle loses its trailing export list; the UI then throws "options is not a function".
const js = readFileSync(join(out, 'pagefind.js'), 'utf8');
if (!/export\s*\{[^}]*\boptions\b[^}]*\}\s*;?\s*$/.test(js)) fail('pagefind.js is truncated');

console.log(`[reindex-search] ok: ${files.length} files`);
