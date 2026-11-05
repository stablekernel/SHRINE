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
const HEX = DIGITS + 'abcdef';
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
    `gitlab: ${j('gl', 'pat-', a(20))}`,
    `npm: ${j('np', 'm_', a(36))}`,
    `huggingface: ${j('h', 'f_', a(34))}`,
    `webhook-secret: ${j('wh', 'sec_', a(32))}`,
    `sendgrid: ${j('S', 'G.', a(22), '.', a(43))}`,
    `google-oauth: ${j('ya', '29.', a(40))}`,
    `twilio: ${j('S', 'K', r(32, DIGITS + 'abcdef'))}`,
    `slack-webhook: ${j('https://hooks', '.slack.com/services/T', r(12, UPPER), '/B', r(12, UPPER), '/', a(24))}`,
    `auth-header: Authorization: ${a(40)}`,
    `azure: ${j('DefaultEndpointsProtocol=https;AccountName=st;Account', 'Key=', a(86), '==;EndpointSuffix=core.windows.net')}`,
    `mysql: mysql -u root -p${a(16)} app`,
    `curl: curl -u ci:${a(18)} https://ci.example.com/api`,
    `docker-auth: {"auths":{"r.example.com":{"auth":"${a(32)}"}}}`,
    `spaced-assign: DB_PASS = ${a(14)}`,
    `auth-header-lower: authorization: ${j('bear', 'er ', a(30))}`,
    `cookie: Cookie: ${j('session', '=', a(40))}; theme=dark`,
    `netrc: machine api.example.com login bob ${j('pass', 'word ', a(16))}`,
    `docker-login: docker login -u bob ${j('-', 'p ', a(16))} registry.example.com`,
    `password-flag: mytool ${j('--pass', 'word ', a(16))}`,
    `vault: ${j('hv', 's.', a(90))}`,
    `slack-app: ${j('xa', 'pp-1-', a(11), '-', r(13, DIGITS), '-', r(64, HEX))}`,
    `pypi: ${j('py', 'pi-', a(60))}`,
    `do-token: ${j('do', 'p_v1_', r(64, HEX))}`,
    `shopify: ${j('sh', 'pat_', r(32, HEX))}`,
    `linear: ${j('lin', '_api_', a(40))}`,
    `databricks: ${j('da', 'pi', r(32, HEX))}`,
    `atlassian: ${j('ATA', 'TT', a(180))}`,
    `sentry: ${j('sn', 'trys_', a(80))}`,
    `discord-webhook: ${j('https://discord', '.com/api/webhooks/', r(18, DIGITS), '/', a(68))}`,
    `azure-sas: https://st.blob.core.windows.net/c?sv=2022-11-02&${j('si', 'g=', a(43))}%3D`,
    `token-hex: ${j('tok', 'en ', r(40, HEX))}`,
    `private-key-pgp-begin:${j(dash, 'BEGIN PGP PRIV', 'ATE KEY BLOCK', dash)}`,
    `private-key-pgp-body: ${a(64)}`,
    `private-key-pgp-end: ${j(dash, 'END PGP PRIV', 'ATE KEY BLOCK', dash)}`,
    `private-key-begin:${j(dash, 'BEGIN RSA PRIV', 'ATE KEY', dash)}`,
    `private-key-body: ${a(64)}`,
    `private-key-end: ${j(dash, 'END RSA PRIV', 'ATE KEY', dash)}`,
    '',
  ].join('\n');
}
