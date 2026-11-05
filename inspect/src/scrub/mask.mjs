// Share-safe masking (spec 7): a known-identifier list built from facts (OS user,
// git authors and emails, home segments, project, repo, and org names) replaced by
// stable placeholders; then emails, hostnames, IPs, and absolute paths. No
// free-text name detection. Ticket IDs are left as they are.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildIdentifiers({ osUser = null, home = null, authors = [], projects = [], repos = [], orgs = [] } = {}) {
  const ids = [];
  const add = (value, placeholder) => {
    if (typeof value !== 'string' || value.length < 2) return;
    if (!ids.some((i) => i.value === value)) ids.push({ value, placeholder });
  };
  const numbered = (values, prefix) =>
    [...new Set(values.filter(Boolean))].sort().forEach((v, i) => add(v, `<${prefix}-${i + 1}>`));

  numbered(authors.map((a) => a.email), 'author-email');
  numbered(authors.map((a) => a.name), 'author');
  numbered(projects, 'project');
  numbered(repos.filter((r) => !projects.includes(r)), 'repo');
  numbered(orgs, 'org');
  if (osUser) add(osUser, '<user>');
  for (const seg of (home ?? '').split(/[\\/]/).filter((s) => s && !['Users', 'home', 'root'].includes(s))) {
    add(seg, '<user>');
    add(seg.replace(/[^A-Za-z0-9-]/g, '-'), '<user>');
  }
  // Longest first, so "shop-api-v2" is masked before "shop-api".
  ids.sort((a, b) => b.value.length - a.value.length);
  return { home, ids };
}

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const TLDS = 'com|net|org|io|dev|ai|app|co|us|uk|de|fr|cloud|internal|local|lan|corp|edu|gov|info|biz|xyz|sh|me|tech|example';
const HOST = new RegExp(`\\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+(?:${TLDS})\\b`, 'g');
// Home paths keep only .claude and the file name; other folders name clients and repos.
// A folder may hold single spaces ("Client Work", "Application Support") when a
// slash follows it, so the whole folder is masked, not just its first word. The
// file name stays space-free: in prose the words after it are not part of it.
const SEG = String.raw`[\w.@+<>-]+(?: [\w.@+<>-]+)*`;
const HOME_PATH = new RegExp(String.raw`(?<![\w.~<>-])~\/((?:${SEG}\/)*)([\w.@+<>-]*)`, 'g');
const collapse = (dirs) => {
  const kept = [];
  for (const seg of dirs) {
    if (seg === '.claude') kept.push(seg);
    else if (kept.at(-1) !== '<path>') kept.push('<path>');
  }
  return kept.map((k) => `${k}/`).join('');
};
const homePath = (_m, dirs, base) => `~/${collapse(dirs.split('/').filter(Boolean))}${base}`;
const ABS_PATH = /(?<![\w~.<>-])\/(?:[\w.@+-]+(?: [\w.@+-]+)*\/)+([\w.@+-]*)/g;
const PROJECT_FOLDER = /(\.claude\/projects\/)[^/\s"'<>]+/g;

// Home prefix to "~" only at a path boundary: home /Users/bob must not turn
// /Users/bobby/x into "~by/x".
export function underHome(path, home) {
  if (!home || typeof path !== 'string') return null;
  const h = home.replace(/[\\/]+$/, '');
  if (path === h) return '';
  return path.startsWith(h) && /^[\\/]/.test(path.slice(h.length)) ? path.slice(h.length) : null;
}

const LOOKS_LIKE_PATH = /^(?:~?[\\/]|[A-Za-z]:[\\/]|[^\s()*:=]+[\\/])/;

// Masks a value known to be a path, segment by segment, so folder names with spaces
// or any other characters never survive. Non-path values fall back to mask().
export function maskPath(value, known) {
  if (typeof value !== 'string' || !LOOKS_LIKE_PATH.test(value)) return mask(value, known);
  let p = value.replace(PROJECT_FOLDER, '$1<project-folder>');
  const rest = underHome(p, known?.home);
  if (rest != null) p = `~${rest}`;
  const segs = p.split(/[\\/]/);
  const base = mask(segs.pop(), known);
  const head = segs[0];
  const lead = head === '~' ? '~/' : head === '' || /^[A-Za-z]:$/.test(head) ? '/' : '';
  const dirs = lead ? segs.slice(1) : segs;
  const kept = collapse(dirs.filter(Boolean));
  if (lead === '/' && kept.startsWith('<path>')) return `${kept}${base}`;
  return `${lead}${kept}${base}`;
}

export function mask(text, known) {
  if (typeof text !== 'string' || text === '') return text;
  // Claude Code project folders encode the full cwd (home, org, and repo names).
  let out = text.replace(PROJECT_FOLDER, '$1<project-folder>');
  if (known?.home) out = out.replace(new RegExp(`${esc(known.home)}(?=/|\\b|$)`, 'g'), '~');
  out = out.replace(EMAIL, (m) => known?.ids.find((i) => i.value === m)?.placeholder ?? '<email>');
  for (const { value, placeholder } of known?.ids ?? []) {
    out = out.replace(new RegExp(`(?<![\\w-])${esc(value)}(?![\\w-])`, 'g'), placeholder);
  }
  out = out.replace(IPV4, '<ip>');
  out = out.replace(HOST, '<host>');
  out = out.replace(HOME_PATH, homePath);
  out = out.replace(ABS_PATH, (_m, base) => `<path>/${base}`);
  return out;
}

// Keys whose values are file paths: masked segment by segment.
const PATH_KEYS = new Set(['path', 'path_scrubbed', 'locator', 'anchor', 'changed_paths', 'cwd', 'touched_files']);
const KEEP = new Set(['shrine_refs', 'shrine_ref', 'shrine', 'url', 'url_pinned', 'entry_id', 'page_id', 'id', 'finding_id']);

export function maskDeep(value, known, key = '') {
  if (KEEP.has(key)) return value;
  if (typeof value === 'string') return PATH_KEYS.has(key) ? maskPath(value, known) : mask(value, known);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, known, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, known, k)]));
  return value;
}
