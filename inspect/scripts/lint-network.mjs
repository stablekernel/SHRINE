// No-network lint: src/ and bin/ import no socket-capable module and reach no
// network global. Judge code (src/judge/ and the adapters' judge.mjs) also reads
// no environment variable and names no API key or token variable: the model call
// is the user's own harness, which handles its own login.
//
// The global rules are structural, not a list of call shapes: in code (comments
// and string text removed) any bare name of a network global or of the global
// object is a problem, however it is then used (called, aliased, passed, or
// wrapped as "(0, fetch)"). Only property access ("opts.fetch") is not a bare name.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

// vm and module run or load code by a computed name; inspector opens a socket.
const MODULE = /^(node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici|worker_threads|vm|module|inspector)$/;
// Module specifiers in import and require forms, matched on the whole file so an
// import split over lines ("import {\n  request,\n} from 'node:http'") is seen.
const SPECIFIERS = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\b(?:import|require)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
];
// import(x) or require(x) with a computed name hides which module it loads.
const COMPUTED_LOAD = /\b(?:import|require)\s*\((?!\s*(?:['"][^'"\n]+['"]|`[^`$\n]+`)\s*\))/g;
// A bare name: not a property ("a.fetch", "a?.fetch") and not part of a longer name.
const bare = (names) => new RegExp(String.raw`(?<!\.\s*)(?<![\w$])(${names})(?![\w$])`, 'g');
const NET_GLOBAL = bare('fetch|WebSocket|EventSource|XMLHttpRequest');
// The global object reaches every global by name, so code never names it.
const GLOBAL_OBJECT = bare('globalThis|global|self|window|navigator');
// Code built from strings or a global read by reflection hides what it calls.
const DYNAMIC = bare('eval|Function|Reflect');
// Named anywhere, as a property or in a string ("x['constructor']"): a beacon send,
// a module loaded by name or a raw binding, and the constructor of any function,
// which compiles code from a string. A class's own "constructor(" opening a line
// is the one exception.
const ANY_ACCESS = /(?<![\w$])(sendBeacon|getBuiltinModule|createRequire|binding|_linkedBinding|dlopen|constructor)(?![\w$])/g;
const CLASS_CONSTRUCTOR = /^[ \t]*constructor\s*\(/;
// process only by a named property ("process.argv"): a bracket ("process['x']")
// or a bare use (an alias, a destructure) hides which property is read.
const PROCESS_OTHER = /(?<!\.\s*)(?<![\w$])process(?![\w$])(?!\s*(?:\?\.|\.)\s*[A-Za-z_$])/g;
const ENV_READ = /\bprocess\s*(?:\?\.|\.)\s*env\b/;
const KEY_NAME = /\b[A-Z_]*(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)\b/;
const isJudgeCode = (r) => r.startsWith('src/judge/') || /^src\/adapters\/[^/]+\/judge\.mjs$/.test(r);

// Characters after which "/" starts a regex literal, not a division.
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

// Returns { comments: source with comments blanked, code: source with comments
// and string, template, and regex text blanked }. Newlines are kept, so line
// numbers hold. Code inside a template's ${ } stays code.
export function strip(src) {
  const comments = src.split('');
  const code = src.split('');
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const braces = []; // brace depth at each open ${ , innermost last
  let depth = 0;
  let i = 0;
  let last = ''; // last code character that is not a space
  const lastWord = () => src.slice(Math.max(0, i - 12), i).trimEnd();
  const template = () => {
    // At a template's text (after ` or }). Ends at ` or at ${.
    const start = i;
    while (i < src.length && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) i += src[i] === '\\' ? 2 : 1;
    blank(code, start, i);
    if (src[i] === '`') {
      i++;
      last = '`';
    } else if (i < src.length) {
      i += 2;
      braces.push(depth);
      depth++;
      last = '{';
    }
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const to = end < 0 ? src.length : end;
      blank(comments, i, to);
      blank(code, i, to);
      i = to;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const to = end < 0 ? src.length : end + 2;
      blank(comments, i, to);
      blank(code, i, to);
      i = to;
    } else if (c === "'" || c === '"') {
      const start = ++i;
      while (i < src.length && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
      blank(code, start, i);
      i++;
      last = c;
    } else if (c === '`') {
      i++;
      template();
    } else if (c === '}' && braces.length && braces[braces.length - 1] === depth - 1) {
      braces.pop();
      depth--;
      i++;
      template();
    } else if (c === '/' && (last === '' || REGEX_AFTER.has(last) || REGEX_KEYWORD.test(lastWord()))) {
      const start = ++i;
      let inClass = false;
      while (i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        i += src[i] === '\\' ? 2 : 1;
      }
      blank(code, start, i);
      i++;
      last = '/';
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return { comments: comments.join(''), code: code.join('') };
}

function lint(file, name) {
  const problems = [];
  const { comments, code } = strip(readFileSync(file, 'utf8'));
  const lineAt = (index) => comments.slice(0, index).split('\n').length;
  const add = (index, message) => problems.push({ file: name, line: lineAt(index), message });
  for (const re of SPECIFIERS) {
    for (const m of comments.matchAll(re)) if (MODULE.test(m[2])) add(m.index, `network module ${m[2]}`);
  }
  for (const m of comments.matchAll(COMPUTED_LOAD)) add(m.index, 'module loaded by a computed name');
  for (const m of code.matchAll(NET_GLOBAL)) add(m.index, `network global ${m[1]}`);
  for (const m of code.matchAll(GLOBAL_OBJECT)) add(m.index, `global object ${m[1]}`);
  for (const m of code.matchAll(DYNAMIC)) add(m.index, `dynamic code or reflection ${m[1]}`);
  for (const m of comments.matchAll(ANY_ACCESS)) {
    const lineStart = comments.lastIndexOf('\n', m.index) + 1;
    if (!(m[1] === 'constructor' && CLASS_CONSTRUCTOR.test(comments.slice(lineStart, m.index + 13)))) add(m.index, `${m[1]} reached`);
  }
  for (const m of code.matchAll(PROCESS_OTHER)) add(m.index, 'process used other than by a named property');
  if (isJudgeCode(name)) {
    code.split('\n').forEach((line, i) => {
      if (ENV_READ.test(line)) problems.push({ file: name, line: i + 1, message: 'environment read in judge code' });
    });
    comments.split('\n').forEach((line, i) => {
      const k = line.match(KEY_NAME);
      if (k) problems.push({ file: name, line: i + 1, message: `key variable ${k[0]} in judge code` });
    });
  }
  return problems;
}

const root = lintRoot(process.argv);
const files = ['src', 'bin'].flatMap((d) => walk(join(root, d), (f) => f.endsWith('.mjs')));
report('lint-network', files.flatMap((file) => lint(file, rel(root, file))));
