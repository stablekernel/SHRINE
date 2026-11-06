// No-network lint: src/ and bin/ import no socket-capable module and call no fetch.
// Judge code (src/judge/ and the adapters' judge.mjs) also reads no environment
// variable and names no API key or token variable: the model call is the user's
// own harness, which handles its own login.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

const MODULES = /['"](node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici|worker_threads)['"]/;
const CALLS = /\b(fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/;
const ENV_READ = /\bprocess\.env\b/;
const KEY_NAME = /\b[A-Z_]*(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)\b/;
const isJudgeCode = (r) => r.startsWith('src/judge/') || /^src\/adapters\/[^/]+\/judge\.mjs$/.test(r);

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
      if (isJudgeCode(at.file) && ENV_READ.test(line)) problems.push({ ...at, message: 'environment read in judge code' });
      const k = isJudgeCode(at.file) && line.match(KEY_NAME);
      if (k) problems.push({ ...at, message: `key variable ${k[0]} in judge code` });
    });
}
report('lint-network', problems);
