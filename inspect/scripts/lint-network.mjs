// No-network lint: src/ and bin/ import no socket-capable module and reach no
// network global. Judge code (src/judge/ and the adapters' judge.mjs) also reads
// no environment variable and names no API key or token variable: the model call
// is the user's own harness, which handles its own login.
//
// The rules are structural, on a real parse (acorn), not on call shapes: any
// reference to a network global or to the global object is a problem, however it
// is then used (called, aliased, passed, or wrapped as "(0, fetch)"). Only a
// property name ("opts.fetch") is not a reference. Escapes in names ("fetch")
// are decoded by the parser, and comments, strings, and regexes are never code.
//
// A guard against accidental network use, not a sandbox: a property name built at
// run time from variables cannot be known statically (see README, Known limits).
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'acorn';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

// vm and module run or load code by a computed name; inspector opens a socket.
const MODULE = /^(node:)?(http|https|http2|net|tls|dgram|dns|dns\/promises|undici|worker_threads|vm|module|inspector)$/;
const NET_GLOBALS = new Set(['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']);
// The global object reaches every global by name, so code never names it.
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'self', 'window', 'navigator']);
// Code built from strings, or a global read by reflection.
const DYNAMIC = new Set(['eval', 'Function', 'Reflect']);
// Names never used, as a property, a key, or a whole string: a beacon send, a
// module loaded by name or a raw binding, a process image swap (execve), and the routes to the Function
// constructor (which compiles code from a string) through prototypes.
const NEVER = new Set(['sendBeacon', 'getBuiltinModule', 'createRequire', 'binding', '_linkedBinding', 'dlopen', 'constructor', 'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', '__proto__', '__lookupGetter__', '__lookupSetter__', '__defineGetter__', '__defineSetter__', 'execve']);
const KEY_NAME = /\b[A-Z_]*(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)\b/;
const isJudgeCode = (r) => r.startsWith('src/judge/') || /^src\/adapters\/[^/]+\/judge\.mjs$/.test(r);

// Every node with its parent and the key it sits under.
function visit(node, fn, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent, key);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc') continue;
    if (Array.isArray(v)) v.forEach((c) => visit(c, fn, node, k));
    else if (v && typeof v === 'object') visit(v, fn, node, k);
  }
}

// An identifier that names a binding or reads one, not a property name or label.
function isReference(parent, key) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false;
  if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return false;
  if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type)) return false;
  if (parent.type === 'MetaProperty') return false;
  if (parent.type === 'ExportSpecifier' && key === 'exported') return false;
  if (parent.type === 'ImportSpecifier' && key === 'imported') return false;
  return true;
}

// A string put together from parts: a template with a ${ } or a "+" with a string
// in it ("'fe' + 'tch'"). Arithmetic ("i + 1") is not one.
const isString = (n) => (n.type === 'Literal' && typeof n.value === 'string') || n.type === 'TemplateLiteral';
const builtString = (n) =>
  (n.type === 'TemplateLiteral' && n.expressions.length > 0) ||
  (n.type === 'BinaryExpression' && n.operator === '+' && (isString(n.left) || isString(n.right) || builtString(n.left) || builtString(n.right)));

// The literal text of a module specifier, or null when it is computed.
const staticText = (n) => (n?.type === 'Literal' && typeof n.value === 'string' ? n.value : n?.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis[0].value.cooked : null);

function lint(root, file, name) {
  const problems = [];
  const add = (node, message) => problems.push({ file: name, line: node.loc.start.line, message });
  const src = readFileSync(file, 'utf8');
  const comments = [];
  let ast;
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true, onComment: comments });
  } catch (e) {
    return [{ file: name, line: e.loc?.line ?? 1, message: `not parsed: ${e.message}` }];
  }
  const judge = isJudgeCode(name);
  const allowed = [join(root, 'src'), join(root, 'bin')];
  const specifier = (node, source) => {
    const s = staticText(source);
    if (s === null) return add(node, 'module loaded by a computed name');
    if (MODULE.test(s)) add(node, `network module ${s}`);
    if (s.startsWith('.')) {
      const target = resolve(dirname(file), s);
      if (!allowed.some((d) => !relative(d, target).startsWith('..') && !relative(d, target).startsWith(sep))) add(node, `import from outside src and bin: ${s}`);
    }
  };
  visit(ast, (node, parent, key) => {
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ExportNamedDeclaration':
        if (node.source) specifier(node, node.source);
        break;
      case 'ImportExpression':
        specifier(node, node.source);
        break;
      case 'CallExpression':
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') specifier(node, node.arguments[0]);
        break;
      case 'Identifier': {
        const n = node.name;
        if (isReference(parent, key)) {
          if (NET_GLOBALS.has(n)) add(node, `network global ${n}`);
          if (GLOBAL_OBJECTS.has(n)) add(node, `global object ${n}`);
          if (DYNAMIC.has(n)) add(node, `dynamic code or reflection ${n}`);
          // process only by a named property ("process.argv"): a bracket or a bare
          // use (an alias, a destructure) hides which property is read.
          if (n === 'process' && !(parent?.type === 'MemberExpression' && key === 'object' && !parent.computed)) add(node, 'process used other than by a named property');
        }
        const ctorMethod = parent?.type === 'MethodDefinition' && parent.kind === 'constructor' && key === 'key';
        if (NEVER.has(n) && !ctorMethod) add(node, `${n} reached`);
        break;
      }
      case 'Literal':
        if (typeof node.value === 'string' && NEVER.has(node.value)) add(node, `${node.value} reached`);
        break;
      case 'MemberExpression':
        // A key put together at run time ("x['constr' + 'uctor']") hides the name.
        if (node.computed && builtString(node.property)) add(node, 'property name built at run time');
        if (judge && !node.computed && node.object.type === 'Identifier' && node.object.name === 'process' && node.property.name === 'env') add(node, 'environment read in judge code');
        break;
      default:
    }
  });
  if (judge) {
    // Comments blanked, keeping line numbers; strings count ("process.env['X_API_KEY']").
    const chars = src.split('');
    for (const c of comments) for (let k = c.start; k < c.end; k++) if (chars[k] !== '\n') chars[k] = ' ';
    chars.join('').split('\n').forEach((line, i) => {
      const k = line.match(KEY_NAME);
      if (k) problems.push({ file: name, line: i + 1, message: `key variable ${k[0]} in judge code` });
    });
  }
  return problems;
}

const root = lintRoot(process.argv);
const files = ['src', 'bin'].flatMap((d) => walk(join(root, d), (f) => f.endsWith('.mjs')));
report('lint-network', files.flatMap((file) => lint(root, file, rel(root, file))));
