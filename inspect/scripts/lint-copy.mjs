// Copy lint (spec 8). Scans src/copy/ sources, the generic pivots, and the
// rendered output of every copy template for em dashes, judgments, dollars, and
// numbers without units.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';
import { copyProblemsDeep, sourceProblems } from '../src/copy/rules.mjs';

const root = lintRoot(process.argv);
const problems = [];

for (const file of walk(join(root, 'src', 'copy'), (f) => f.endsWith('.mjs'))) {
  if (file.endsWith('rules.mjs')) continue;
  for (const p of sourceProblems(readFileSync(file, 'utf8'))) problems.push({ file: rel(root, file), ...p });
}

const pivots = join(root, 'src', 'catalogue', 'generic-pivots.json');
if (existsSync(pivots)) {
  for (const message of copyProblemsDeep(JSON.parse(readFileSync(pivots, 'utf8')))) {
    problems.push({ file: rel(root, pivots), line: 0, message });
  }
}

const templates = join(root, 'src', 'copy', 'templates.mjs');
if (existsSync(templates)) {
  const mod = await import(pathToFileURL(templates).href);
  if (typeof mod.sampleCopy === 'function') {
    for (const message of copyProblemsDeep(mod.sampleCopy())) {
      problems.push({ file: rel(root, templates), line: 0, message: `rendered ${message}` });
    }
  }
}

report('lint-copy', problems);
