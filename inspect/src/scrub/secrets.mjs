// Default scrub, always on (spec 7): credentials and tokens never reach a file
// on disk or the report. Pattern based; share-safe masking is the backstop.

const R = (kind) => `[REDACTED:${kind}]`;

// Linear time: a key starts only at a name boundary, is at most 128 chars, and a
// bounded lookahead checks it holds a keyword, so long runs cannot backtrack.
const KEYWORD = '(?:password|passwd|pwd|(?<![a-z])pass(?![a-z])|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token|credential)';
const ASSIGNMENT = new RegExp(
  `(?<![\\w-])(?=[\\w-]{0,64}?${KEYWORD})([\\w-]{1,128})(?![\\w-])(["']?\\s{0,8}[:=]\\s{0,8}["']?)(?![\\w-]{0,64}?(?:password|secret|key|token)[\\w-]{0,64}\\s{0,8}[:=])([^\\s"',;]{3,})`,
  'gi',
);

const PASSWORDISH = /pass|pwd/i;

const RULES = [
  ['private-key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, () => R('private-key')],
  ['connection-string', /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s'"<>]+/gi, () => R('connection-string')],
  ['url-credentials', /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/:@'"]+:[^\s/@'"]+@/gi, (_m, scheme) => `${scheme}${R('credentials')}@`],
  ['anthropic', /\bsk-ant-[A-Za-z0-9_-]{16,}/g, () => R('api-key')],
  ['openai', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, () => R('api-key')],
  ['aws-access', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/g, () => R('aws-key')],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g, () => R('github-token')],
  ['slack', /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g, () => R('slack-token')],
  ['google', /\bAIza[0-9A-Za-z_-]{30,}/g, () => R('api-key')],
  ['stripe', /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/g, () => R('api-key')],
  // Segment lengths are bounded so a long "eyJ-eyJ-..." run cannot go quadratic.
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,1024}\.[A-Za-z0-9_-]{8,8192}\.[A-Za-z0-9_-]{8,1024}/g, () => R('jwt')],
  ['bearer', /\b(Bearer|Token|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, (_m, word) => `${word} ${R('token')}`],
  ['gitlab', /\bgl(?:pat|dt|ptt|rt|cbt|oas|soat|ft|imt|agent|ffct)-[A-Za-z0-9_-]{20,}/g, () => R('gitlab-token')],
  ['npm', /\bnpm_[A-Za-z0-9]{30,}/g, () => R('npm-token')],
  ['huggingface', /\bhf_[A-Za-z0-9]{30,}/g, () => R('api-key')],
  ['webhook-secret', /\bwhsec_[A-Za-z0-9+/=]{20,}/g, () => R('secret')],
  ['sendgrid', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, () => R('api-key')],
  ['google-oauth', /\bya29\.[A-Za-z0-9_-]{20,}/g, () => R('token')],
  ['twilio', /\bSK[0-9a-f]{32}\b/g, () => R('api-key')],
  ['vault', /\bhv[sbr]\.[A-Za-z0-9_-]{24,}/g, () => R('vault-token')],
  ['slack-app', /\bxapp-\d-[A-Za-z0-9-]{10,}/g, () => R('slack-token')],
  ['pypi', /\bpypi-[A-Za-z0-9_-]{50,}/g, () => R('api-key')],
  ['digitalocean', /\bdo[por]_v1_[a-f0-9]{64}\b/g, () => R('api-key')],
  ['shopify', /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g, () => R('api-key')],
  ['linear', /\blin_(?:api|oauth)_[A-Za-z0-9]{32,}/g, () => R('api-key')],
  ['databricks', /\bdapi[a-f0-9]{32}(?:-\d)?\b/g, () => R('api-key')],
  ['atlassian', /\bATATT[A-Za-z0-9_=-]{20,}/g, () => R('api-key')],
  ['sentry', /\bsntry[su]_[A-Za-z0-9+/=_-]{30,}/g, () => R('api-key')],
  ['token-hex', /\b([Tt]oken\s{1,4}["']?)[0-9a-f]{40}\b/g, (_m, head) => `${head}${R('token')}`],
  ['discord-webhook', /\bhttps:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, () => R('webhook')],
  ['azure-sas', /([?&]sig=)[A-Za-z0-9%+/=]{16,}/g, (_m, head) => `${head}${R('secret')}`],
  ['slack-webhook', /\bhttps:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]+/g, () => R('webhook')],
  ['auth-bearer', /\b(authorization\s{0,4}[:=]\s{0,4}["']?bearer\s{1,4})[A-Za-z0-9._~+/=-]{16,}/gi, (_m, head) => `${head}${R('token')}`],
  ['cookie', /\b((?:Set-)?Cookie\s{0,4}:\s{0,4})[^\s=;]{1,64}=[^\r\n'"]{1,4096}/gi, (_m, head) => `${head}${R('cookie')}`],
  ['auth-header', /\b(Authorization\s{0,4}[:=]\s{0,4}["']?)(?!(?:Bearer|Token|Basic)\s)[A-Za-z0-9._~+/=-]{16,}/gi, (_m, head) => `${head}${R('token')}`],
  ['azure-key', /\b((?:Account|SharedAccess)Key\s{0,4}=\s{0,4})[A-Za-z0-9+/]{16,}={0,2}/g, (_m, head) => `${head}${R('secret')}`],
  ['docker-auth', /("auth"\s{0,4}:\s{0,4}")[A-Za-z0-9+/=]{8,}"/g, (_m, head) => `${head}${R('secret')}"`],
  // CLI passwords: mysql -p<pw> / --password=<pw>, curl -u user:<pw>. Scans are bounded.
  ['mysql-cli', /(\bmysql(?:dump|admin|sh)?\b[^\n]{0,200}?\s(?:-p|--password=))[^\s'"-][^\s'"]*/g, (_m, head) => `${head}${R('secret')}`],
  ['curl-user', /(\bcurl\b[^\n]{0,200}?\s(?:-u|--user)[\s=]{0,4}["']?[^\s:'"]{1,64}:)[^\s'"]+/g, (_m, head) => `${head}${R('secret')}`],
  // netrc "login <user> password <pw>", docker login -p <pw>, and a bare
  // --password <pw> (a value that is all letters must be 8+ chars, so prose like
  // "--password when prompted" stays).
  ['netrc', /\b(login\s{1,4}[^\s]{1,128}\s{1,4}password\s{1,4})[^\s'"]+/g, (_m, head) => `${head}${R('secret')}`],
  ['docker-login', /(\bdocker\s{1,4}login\b[^\n]{0,200}?\s(?:-p|--password)[\s=]{1,4}["']?)[^\s'"]+/g, (_m, head) => `${head}${R('secret')}`],
  ['password-flag', /((?:^|\s)--password\s{1,4}["']?)(?!-)(?:(?=[^\s'"]{0,128}[^A-Za-z\s'"])[^\s'"]{1,128}|[A-Za-z]{8,128})(?![^\s'"])/g, (_m, head) => `${head}${R('secret')}`],
  // Values under 8 chars are kept unless the key names a password.
  ['assignment', ASSIGNMENT, (m, key, sep, value) => (value.length < 8 && !PASSWORDISH.test(key) ? m : `${key}${sep}${R('secret')}`)],
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
