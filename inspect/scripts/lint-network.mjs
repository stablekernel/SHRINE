// No-network lint: src/ and bin/ import no socket-capable module and call no fetch.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

const MODULES = /['"](node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici|worker_threads)['"]/;
const CALLS = /\b(fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/;

const root = lintRoot(process.argv);
const files = ['src', 'bin'].flatMap((d) => walk(join(root, d), (f) => f.endsWith('.mjs')));
const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      const at = { file: rel(root, file), line: i + 1 };
      const m = line.match(MODULES);
      if (m && /import|require/.test(line)) problems.push({ ...at, message: `network module ${m[0].replace(/['"]/g, '')}` });
      const c = line.match(CALLS);
      if (c) problems.push({ ...at, message: `network call ${c[1]}` });
    });
}
report('lint-network', problems);
