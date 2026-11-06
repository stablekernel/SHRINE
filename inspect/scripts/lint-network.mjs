// No-network lint: src/ and bin/ import no socket-capable module and call no fetch.
// Judge code (src/judge/ and the adapters' judge.mjs) also reads no environment
// variable and names no API key or token variable: the model call is the user's
// own harness, which handles its own login.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

const MODULE = /^(node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici|worker_threads)$/;
// Module specifiers in import and require forms, matched on the whole file so an
// import split over lines ("import {\n  request,\n} from 'node:http'") is seen.
const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
];
// import(x) or require(x) with a computed name hides which module it loads.
const COMPUTED_LOAD = /\b(?:import|require)\s*\((?!\s*(?:['"][^'"\n]+['"]|`[^`$\n]+`)\s*\))/g;
// Matched on the whole file: "fetch\n(u)" is still a call.
const CALLS = /\b(fetch|WebSocket|EventSource|XMLHttpRequest)\s*(?:\(|\.\s*(?:call|apply|bind)\b)/g;
// A network global taken by destructuring ("const { fetch: f } = globalThis"), or a
// require made from createRequire, whose calls the module rules cannot see.
const INDIRECT = /\{[^{}]*\b(fetch|WebSocket|EventSource|XMLHttpRequest)\b[^{}]*\}\s*=\s*(?:globalThis|global|self|window)\b|\b(createRequire)\b/g;
// Code built from strings, a global read through Reflect, or a built-in module
// loaded by process.getBuiltinModule hides what it calls.
const DYNAMIC_CODE = /\b(?:eval|Function)\s*\(|\bprocess\s*\.\s*getBuiltinModule\b|\bReflect\s*\.\s*get\s*\(\s*(?:globalThis|global|self|window)\b/;
// globalThis['fe' + 'tch'] reaches a network global by a computed name.
const GLOBAL = String.raw`\b(?:globalThis|global|self|window)\s*`;
const COMPUTED_GLOBAL = new RegExp(String.raw`${GLOBAL}(?:\?\.)?\s*\[`);
const GLOBAL_NET = new RegExp(String.raw`${GLOBAL}\??\.\s*(fetch|WebSocket|EventSource|XMLHttpRequest)\b`);
const ENV_READ = /\bprocess\.env\b/;
const KEY_NAME = /\b[A-Z_]*(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)\b/;
const isJudgeCode = (r) => r.startsWith('src/judge/') || /^src\/adapters\/[^/]+\/judge\.mjs$/.test(r);

const root = lintRoot(process.argv);
const files = ['src', 'bin'].flatMap((d) => walk(join(root, d), (f) => f.endsWith('.mjs')));
const problems = [];
for (const file of files) {
  // Whole-line comments are blanked, keeping line numbers.
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (line.trim().startsWith('//') ? '' : line));
  const text = lines.join('\n');
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  for (const re of SPECIFIERS) {
    for (const m of text.matchAll(re)) {
      if (MODULE.test(m[2])) problems.push({ file: rel(root, file), line: lineAt(m.index), message: `network module ${m[2]}` });
    }
  }
  for (const m of text.matchAll(COMPUTED_LOAD)) problems.push({ file: rel(root, file), line: lineAt(m.index), message: 'module loaded by a computed name' });
  for (const m of text.matchAll(CALLS)) problems.push({ file: rel(root, file), line: lineAt(m.index), message: `network call ${m[1]}` });
  for (const m of text.matchAll(INDIRECT)) problems.push({ file: rel(root, file), line: lineAt(m.index), message: m[1] ? `network global ${m[1]} taken indirectly` : 'require built by createRequire' });
  lines.forEach((line, i) => {
    const at = { file: rel(root, file), line: i + 1 };
    if (COMPUTED_GLOBAL.test(line)) problems.push({ ...at, message: 'global read by a computed name' });
    if (DYNAMIC_CODE.test(line)) problems.push({ ...at, message: 'dynamic code or reflected global' });
    const g = line.match(GLOBAL_NET);
    if (g) problems.push({ ...at, message: `network global ${g[1]}` });
    if (isJudgeCode(at.file) && ENV_READ.test(line)) problems.push({ ...at, message: 'environment read in judge code' });
    const k = isJudgeCode(at.file) && line.match(KEY_NAME);
    if (k) problems.push({ ...at, message: `key variable ${k[0]} in judge code` });
  });
}
report('lint-network', problems);
