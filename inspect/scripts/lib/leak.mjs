// Leak check for a rendered report (release dry run, real-run driver, T1 leak
// test). Secrets, paths, prompts, and absolute paths match anywhere in the raw
// page. Project names and the OS user are often ordinary words ("scope",
// "skills", "root"), so they match as whole tokens, and only outside text this
// package ships itself: the inlined assets, catalogue strings, and the fixed
// parts of string literals in src/. Dependency free: the dry-run CI job has no
// node_modules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PKG_ROOT, walk } from './walk.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wordRe = (w, flags = '') => new RegExp(`(?<![\\w-])${esc(w)}(?![\\w-])`, flags);

const UNESCAPE = { n: '\n', t: '\t', r: '', '\n': '' };
const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw']);

// The fixed parts of string and template literals in JS source, comments and
// regex literals skipped. A small lexer, not a parser: it only has to hold for
// this package's own code.
export function literals(src) {
  const out = [];
  const tpl = []; // brace depth inside each open template's ${ }
  let i = 0;
  let prev = '';
  let word = '';
  const template = () => {
    let s = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        s += UNESCAPE[src[i + 1]] ?? src[i + 1];
        i += 2;
      } else if (c === '`') {
        i++;
        prev = 'a';
        return out.push(s);
      } else if (c === '$' && src[i + 1] === '{') {
        i += 2;
        tpl.push(0);
        prev = '(';
        return out.push(s);
      } else {
        s += c;
        i++;
      }
    }
    return out.push(s);
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      i = j < 0 ? src.length : j;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      i = j < 0 ? src.length : j + 2;
    } else if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          s += UNESCAPE[src[i + 1]] ?? src[i + 1];
          i += 2;
        } else s += src[i++];
      }
      i++;
      out.push(s);
      prev = 'a';
    } else if (c === '`') {
      i++;
      template();
    } else if (tpl.length && c === '}' && tpl.at(-1) === 0) {
      tpl.pop();
      i++;
      template();
    } else if (c === '/' && (REGEX_PREV.has(prev) || REGEX_KW.has(word))) {
      let cls = false;
      for (i++; i < src.length && src[i] !== '\n'; i++) {
        if (src[i] === '\\') i++;
        else if (cls) cls = src[i] !== ']';
        else if (src[i] === '[') cls = true;
        else if (src[i] === '/') break;
      }
      i++;
      while (/[a-z]/.test(src[i] ?? '')) i++;
      prev = 'a';
      word = '';
    } else if (/\s/.test(c)) i++;
    else {
      if (tpl.length && c === '{') tpl[tpl.length - 1]++;
      if (tpl.length && c === '}') tpl[tpl.length - 1]--;
      word = /[\w$]/.test(c) ? (/[\w$]/.test(prev) ? word : '') + c : '';
      prev = c;
      i++;
    }
  }
  return out;
}

// Text this package ships, as chunks to cut out of a page before names are
// matched. A chunk needs a space or markup in it and 8 or more characters, so
// a bare word ("SHRINE", "scope") never hides a name. keys: property names in
// src code, the findings schema's own JSON keys.
let cached = null;
export function shippedText(root = join(PKG_ROOT, 'src')) {
  if (cached?.root === root) return cached;
  const chunks = new Set();
  const keys = new Set();
  const words = new Set();
  const add = (s) => {
    const t = s.trim();
    if (t.length >= 8 && /[\s<>="/]/.test(t)) chunks.add(t);
    else if (t) words.add(t);
  };
  const strings = (v) => {
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x);
  };
  for (const f of walk(root, () => true)) {
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.mjs') || f.endsWith('.js')) {
      for (const s of literals(text)) add(s);
      for (const m of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1]);
    }
    if (f.endsWith('.json')) strings(JSON.parse(text));
    // Inlined verbatim into every report.
    if (/[\\/]render[\\/]assets[\\/]/.test(f)) chunks.add(text);
  }
  cached = { root, chunks: [...chunks].sort((a, b) => b.length - a.length), keys, words, app: readFileSync(join(root, 'render', 'assets', 'app.js'), 'utf8') };
  return cached;
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// The page with its JSON data blocks flattened to their values (and any key
// the package does not use itself), entities decoded, and shipped text cut out.
export function unshipped(html, shipped = shippedText()) {
  const SEP = '\u0000';
  const flat = html.replace(/(<script type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g, (all, a, body, b) => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return all;
    }
    const parts = [];
    const visit = (v) => {
      if (typeof v === 'string') parts.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') {
        // A configured count ({item, count}) reads as the page shows it: "skills: 112".
        const counted = typeof v.item === 'string' && typeof v.count === 'number';
        if (counted) parts.push(`${v.item}: ${v.count}`);
        for (const [k, x] of Object.entries(v)) {
          if (counted && (k === 'item' || k === 'count')) continue;
          if (!shipped.keys.has(k)) parts.push(k);
          visit(x);
        }
      }
      else if (v !== null && v !== undefined) parts.push(String(v));
    };
    visit(data);
    return `${a}${SEP}${parts.join(SEP)}${SEP}${b}`;
  });
  let t = decode(flat);
  for (const c of shipped.chunks) if (t.includes(c)) t = t.split(c).join(SEP);
  return t;
}

// OS user mentions as whole tokens. Ignored only where they are code: a CSS
// selector token inside <style> (":root", ".x", "#x"), and the page's inline
// script when it is byte for byte the shipped app.js. Anywhere else, the
// findings JSON included, a mention counts.
export function userMentions(text, user, shipped = shippedText()) {
  if (!user) return [];
  const skip = [];
  for (const m of text.matchAll(/<script>([\s\S]*?)<\/script>/g)) if (m[1] === shipped.app) skip.push([m.index, m.index + m[0].length, false]);
  for (const m of text.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)) skip.push([m.index, m.index + m[0].length, true]);
  const out = [];
  for (const m of text.matchAll(wordRe(user, 'g'))) {
    const s = skip.find(([a, b]) => m.index >= a && m.index < b);
    if (s && (!s[2] || /[:.#]/.test(text[m.index - 1]))) continue;
    out.push(text.slice(Math.max(0, m.index - 40), m.index + user.length + 20));
  }
  return out;
}

// True only for a count label: one of the package's own short strings, alone
// in its text run and followed by a number ("skills: 112"). The same word
// standing alone with no count, or inside other text, still counts as a name.
function label(rest, at, n, shipped) {
  if (!shipped.words.has(n)) return false;
  const before = Math.max(rest.lastIndexOf('\u0000', at - 1), rest.lastIndexOf('>', at - 1));
  const ends = [rest.indexOf('\u0000', at), rest.indexOf('<', at)].filter((x) => x >= 0);
  const run = rest.slice(before + 1, ends.length ? Math.min(...ends) : rest.length).trim();
  return new RegExp(`^${esc(n)}: [\\d,]+$`).test(run);
}

// Needles found in an HTML report.
export function leaks(text, { secrets = [], paths = [], names = [], prompts = [], user = null }, shipped = shippedText()) {
  const found = [];
  for (const [kind, list] of [['secret', secrets], ['path', paths], ['prompt', prompts]]) {
    for (const n of list) if (n && text.includes(n)) found.push(`${kind}: ${kind === 'secret' ? `${n.slice(0, 4)}...` : n}`);
  }
  if (names.some(Boolean)) {
    const rest = unshipped(text, shipped);
    for (const n of names) if (n && [...rest.matchAll(wordRe(n, 'g'))].some((m) => !label(rest, m.index, n, shipped))) found.push(`name: ${n}`);
  }
  if (userMentions(text, user, shipped).length) found.push('user name');
  const abs = text.match(/\/(Users|home|private|var\/folders|tmp)\/[\w.-]+\//);
  if (abs) found.push(`absolute path: ${abs[0]}`);
  return found;
}
