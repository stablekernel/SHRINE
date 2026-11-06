// Copy rules (spec 8): no em dashes, no character judgments, no dollars,
// every number has a unit. Pure functions, shared by scripts/lint-copy.mjs and tests.

const EM_DASH = /—/;
const JUDGMENT = /\b(you failed|you forgot|bad|lazy|careless|sloppy|incompetent|stupid|terrible|awful|poor job)\b/i;
const DOLLARS = /\$\s?\d|\b(dollars?|usd)\b/i;

// A unit is a counted noun or a symbol right after the number ("3 rules", "40 KB", "12%").
const UNIT_AFTER = /^(%|\s*[A-Za-z])/;
const NUMBER = /(?<![\w.:/-])\d[\d,]*(\.\d+)?/g;
// Numbers that are labels, not quantities: dates, versions, tier names, ids.
const EXEMPT_BEFORE = /(tier|t|v|version|step|phase|gate|node|schema_version|wcag|level)\s*$/i;

export function copyProblems(text) {
  const problems = [];
  if (typeof text !== 'string' || text === '') return problems;
  if (EM_DASH.test(text)) problems.push('em dash');
  const j = text.match(JUDGMENT);
  if (j) problems.push(`character judgment "${j[0]}"`);
  if (DOLLARS.test(text)) problems.push('dollars');
  const scrubbed = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, 'DATE').replace(/\b\d+\.\d+\.\d+\b/g, 'VER');
  for (const m of scrubbed.matchAll(NUMBER)) {
    const before = scrubbed.slice(0, m.index);
    const after = scrubbed.slice(m.index + m[0].length);
    if (EXEMPT_BEFORE.test(before)) continue;
    if (!UNIT_AFTER.test(after)) problems.push(`number without unit "${m[0]}"`);
  }
  return problems;
}

// Walk any JSON-like value and return problems for every string leaf.
export function copyProblemsDeep(value, path = '$') {
  if (typeof value === 'string') return copyProblems(value).map((p) => `${path}: ${p}`);
  if (Array.isArray(value)) return value.flatMap((v, i) => copyProblemsDeep(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => copyProblemsDeep(v, `${path}.${k}`));
  }
  return [];
}

// Source-level checks for files under src/copy: lines that are not comments.
export function sourceProblems(source) {
  const out = [];
  source.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (EM_DASH.test(line)) out.push({ line: i + 1, message: 'em dash' });
    const j = line.match(JUDGMENT);
    if (j) out.push({ line: i + 1, message: `character judgment "${j[0]}"` });
    if (DOLLARS.test(line.replace(/\$\{/g, ''))) out.push({ line: i + 1, message: 'dollars' });
  });
  return out;
}
