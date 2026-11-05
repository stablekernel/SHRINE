// Default scrub, always on (spec 7): credentials and tokens never reach a file
// on disk or the report. Pattern based; share-safe masking is the backstop.

const R = (kind) => `[REDACTED:${kind}]`;

// Linear time: a key starts only at a name boundary, is at most 128 chars, and a
// bounded lookahead checks it holds a keyword, so long runs cannot backtrack.
const KEYWORD = '(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token|credential)';
const ASSIGNMENT = new RegExp(
  `(?<![\\w-])(?=[\\w-]{0,64}?${KEYWORD})([\\w-]{1,128})(?![\\w-])(["']?\\s{0,8}[:=]\\s{0,8}["']?)(?![\\w-]{0,64}?(?:password|secret|key|token)[\\w-]{0,64}\\s{0,8}[:=])([^\\s"',;]{8,})`,
  'gi',
);

const RULES = [
  ['private-key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, () => R('private-key')],
  ['connection-string', /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s'"<>]+/gi, () => R('connection-string')],
  ['url-credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/:@'"]+:[^\s/@'"]+@/gi, (_m, scheme) => `${scheme}${R('credentials')}@`],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{16,}/g, () => R('api-key')],
  ['openai', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, () => R('api-key')],
  ['aws-access', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g, () => R('aws-key')],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g, () => R('github-token')],
  ['slack', /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g, () => R('slack-token')],
  ['google', /\bAIza[0-9A-Za-z_-]{30,}/g, () => R('api-key')],
  ['stripe', /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g, () => R('api-key')],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, () => R('jwt')],
  ['bearer', /\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, (_m, word) => `${word} ${R('token')}`],
  ['assignment', ASSIGNMENT, (_m, key, sep) => `${key}${sep}${R('secret')}`],
];

export function scrubSecrets(text) {
  if (typeof text !== 'string' || text === '') return text;
  let out = text;
  const assigns = /[:=]/.test(out);
  for (const [name, re, fn] of RULES) if (name !== 'assignment' || assigns) out = out.replace(re, fn);
  return out;
}

// Applies scrubSecrets to every string in a JSON-like value.
export function scrubDeep(value) {
  if (typeof value === 'string') return scrubSecrets(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  return value;
}
