// Shared helpers for the package scripts (test runner and lints).
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function walk(dir, accept) {
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full);
  }
  return out;
}

// Lints scan src/ and bin/ under --root (default: the package root).
export function lintRoot(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 ? argv[i + 1] : PKG_ROOT;
}

export function rel(root, file) {
  return relative(root, file).split(sep).join('/');
}

export function report(name, problems) {
  for (const p of problems) console.log(`${p.file}:${p.line}: ${p.message}`);
  if (problems.length) {
    console.log(`${name}: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(`${name}: clean`);
}
