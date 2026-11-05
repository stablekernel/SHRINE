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
const ABS_PATH = /(?<![\w~.<>-])\/(?:[\w.@+-]+\/)+([\w.@+-]*)/g;

export function mask(text, known) {
  if (typeof text !== 'string' || text === '') return text;
  // Claude Code project folders encode the full cwd (home, org, and repo names).
  let out = text.replace(/(\.claude\/projects\/)[^/\s"'<>]+/g, '$1<project-folder>');
  if (known?.home) out = out.replace(new RegExp(`${esc(known.home)}(?=/|\\b|$)`, 'g'), '~');
  out = out.replace(EMAIL, (m) => known?.ids.find((i) => i.value === m)?.placeholder ?? '<email>');
  for (const { value, placeholder } of known?.ids ?? []) {
    out = out.replace(new RegExp(`(?<![\\w-])${esc(value)}(?![\\w-])`, 'g'), placeholder);
  }
  out = out.replace(IPV4, '<ip>');
  out = out.replace(HOST, '<host>');
  out = out.replace(ABS_PATH, (_m, base) => `<path>/${base}`);
  return out;
}

const KEEP = new Set(['shrine_refs', 'shrine_ref', 'shrine', 'url', 'url_pinned', 'entry_id', 'page_id', 'anchor', 'id', 'finding_id']);

export function maskDeep(value, known, key = '') {
  if (KEEP.has(key)) return value;
  if (typeof value === 'string') return mask(value, known);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, known));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, known, k)]));
  return value;
}
