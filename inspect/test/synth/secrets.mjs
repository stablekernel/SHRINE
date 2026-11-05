// Planted-secret corpus for the scrubber tests, built at test time. No value in
// this file is shaped like a credential: every prefix is split and every body is
// generated from a fixed seed, so secret scanners have nothing to match in the
// repo, while the scrubber still sees each secret class in full.

// Deterministic pseudo-random characters (LCG), so runs are repeatable.
function gen(seed) {
  let x = seed >>> 0;
  return (n, alphabet) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      s += alphabet[(x >>> 8) % alphabet.length];
    }
    return s;
  };
}
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = LOWER.toUpperCase();
const DIGITS = '0123456789';
const ALNUM = UPPER + LOWER + DIGITS;
const j = (...parts) => parts.join('');

// One line per secret class, "<label>: <text>"; the header lines start with #.
export function plantedCorpus(seed = 7) {
  const r = gen(seed);
  const a = (n) => r(n, ALNUM);
  const dash = '-----';
  return [
    '# Planted secrets, generated at test time. Each line after a colon must not survive the default scrub.',
    '# All values are synthetic and invalid.',
    `anthropic: export ANTHROPIC_API_KEY=${j('sk', '-ant-', 'api03-', a(40))}`,
    `openai: key ${j('sk', '-proj-', a(48))}`,
    `aws-access: ${j('AK', 'IA', r(16, UPPER + DIGITS))}`,
    `aws-secret: ${j('aws_secret', '_access_key', ' = ', a(40))}`,
    `github: token ${j('gh', 'p_', a(36))}`,
    `github-pat: ${j('github', '_pat_', a(22), '_', a(18))}`,
    `slack: ${j('xo', 'xb-', r(12, DIGITS), '-', a(24))}`,
    `google: ${j('AI', 'za', a(35))}`,
    `stripe: ${j('sk', '_live_', a(24))}`,
    `jwt: ${j('ey', 'J', a(20), '.', a(30), '.', a(26))}`,
    `bearer: Authorization: ${j('Bear', 'er ', a(32))}`,
    `connection: ${j('postgres', '://admin:', a(12), '@db.internal.example:5432/app')}`,
    `connection-mongo: ${j('mongodb+srv', '://svc:', a(14), '@cluster0.example.net/prod?retryWrites=true')}`,
    `url-password: ${j('https', '://deploy:', a(16), '@git.example.com/org/repo.git')}`,
    `password-assign: ${j('pass', 'word="', a(14), '"')}`,
    `private-key-begin: ${j(dash, 'BEGIN RSA PRIV', 'ATE KEY', dash)}`,
    `private-key-body: ${a(64)}`,
    `private-key-end: ${j(dash, 'END RSA PRIV', 'ATE KEY', dash)}`,
    '',
  ].join('\n');
}
