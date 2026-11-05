import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scrubSecrets } from '../../src/scrub/secrets.mjs';
import { plantedCorpus } from '../synth/secrets.mjs';
import { buildIdentifiers, mask, maskBase, maskDeep, maskPath } from '../../src/scrub/mask.mjs';
import { displayPath } from '../../src/scorer/score.mjs';
import { growth as growthOf, repeatTo } from '../synth/growth.mjs';

const corpus = plantedCorpus();
const body = corpus
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n');
const STOP = new Set(['Authorization', 'authorization', 'DefaultEndpointsProtocol', 'EndpointSuffix']);
const needles = [...new Set(body.match(/[A-Za-z0-9]{12,}/g))].filter((n) => !STOP.has(n));

test('planted corpus has zero survivors after the default scrub', () => {
  assert.ok(needles.length >= 15, `corpus too small: ${needles.length}`);
  const out = scrubSecrets(body);
  const survivors = needles.filter((n) => out.includes(n));
  assert.deepEqual(survivors, []);
});

test('each line scrubbed on its own also has zero survivors (except the split key body)', () => {
  for (const line of body.split('\n').filter((l) => l && !l.startsWith('private-key'))) {
    const out = scrubSecrets(line);
    for (const n of needles) assert.ok(!out.includes(n) || !line.includes(n), `survived in: ${out}`);
  }
});

test('scrub keeps ordinary text intact', () => {
  const s = 'Run npm test before commit. Ticket ABC-123 tracks it. See https://example.com/docs.';
  assert.equal(scrubSecrets(s), s);
});

const ids = buildIdentifiers({
  osUser: 'jdoe',
  home: '/Users/jdoe',
  authors: [{ name: 'Jane Doe', email: 'jane@acme.example' }],
  projects: ['shop-api'],
  repos: ['shop-api', 'billing'],
  orgs: ['acme-corp'],
});

test('mask replaces known identifiers with stable placeholders', () => {
  const a = mask('Jane Doe (jdoe) pushed shop-api and billing to acme-corp', ids);
  assert.ok(!/Jane Doe|jdoe|shop-api|billing|acme-corp/.test(a), a);
  assert.equal(a, mask('Jane Doe (jdoe) pushed shop-api and billing to acme-corp', ids), 'stable');
  assert.match(a, /<author-1>/);
  assert.match(a, /<user>/);
});

test('mask covers home segments, emails, hostnames, IPs, and absolute paths', () => {
  const s = 'File /Users/jdoe/work/shop-api/CLAUDE.md, mail ops@corp.example.com, host build01.acme.io, ip 10.1.2.3, path /opt/tools/bin/run';
  const out = mask(s, ids);
  for (const leak of ['/Users/jdoe', 'jdoe', 'ops@corp.example.com', 'build01.acme.io', '10.1.2.3', '/opt/tools']) {
    assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
  }
  assert.match(out, /~\/<path>\/CLAUDE\.md/);
  assert.match(out, /<email>/);
  assert.match(out, /<host>/);
  assert.match(out, /<ip>/);
});

test('mask covers encoded project folders and dashed user names', () => {
  const k = buildIdentifiers({ home: '/Users/j.doe' });
  const out = mask('~/.claude/projects/-Users-j-doe-src-acme-shop/memory/MEMORY.md and ~/src/github/j-doe/x', k);
  assert.ok(!/j-doe|acme|shop/.test(out), out);
  assert.match(out, /~\/\.claude\/<path>\/MEMORY\.md/);
});

test('ticket IDs are not masked', () => {
  assert.match(mask('Fixes ABC-123 and PROJ-9', ids), /ABC-123 and PROJ-9/);
});

test('maskDeep leaves SHRINE references alone', () => {
  const o = { lead: 'jdoe edited it', shrine_refs: [{ url_pinned: 'https://github.com/stablekernel/SHRINE/blob/x', title: 'Deliberate Currency' }] };
  const out = maskDeep(o, ids);
  assert.equal(out.lead, '<user> edited it');
  assert.deepEqual(out.shrine_refs, o.shrine_refs);
});

test('maskDeep masks a finding anchor, which is a user file path', () => {
  const out = maskDeep({ anchor: '~/.claude/projects/-Users-jdoe-src-acme-corp-shop-api/memory/MEMORY.md' }, ids);
  assert.ok(!/jdoe|acme|shop/.test(out.anchor), out.anchor);
});

const growth = (build, run = scrubSecrets) => growthOf(build, run);

test('growth flags a quadratic regex', () => {
  // An 8ms base run (not 2ms) and best of 7: fixed overhead and load noise shrink
  // next to the n^2 term, so a true quadratic reads 13-16, clear of the bar.
  const opts = { minMs: 8, tries: 7 };
  // Every start position runs to the end of the input before failing: O(n^2).
  const g = growthOf((n) => 'x-'.repeat(n / 2), (s) => /(?:x-)+=/.test(s), opts);
  // The same limit the linear-time tests use, so they would catch this.
  assert.ok(g >= 10, `quadratic regex grew only ${g.toFixed(1)}x`);
  // The old share-safe email rule: an unbounded local part before a word boundary.
  const old = growthOf(repeatTo('a.'), (s) => s.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>'), opts);
  assert.ok(old >= 10, `old email rule grew only ${old.toFixed(1)}x`);
});

test('mask runs in linear time on adversarial runs', () => {
  const k = buildIdentifiers({ osUser: 'bob', home: '/Users/bob', projects: ['repo'] });
  // Email, host, and IP shapes; then free-text path shapes.
  const units = ['a.', 'a-', 'x.', 'x-x.', '1.', '1.1.', 'a@', 'a.a@', '%+', 'x.co.', '-.', '~/A ', '/a ', ' /a', '/A A', ' C:\\a', "a'b ", '/a, ', ' /a/A ', '/(a) '];
  for (const unit of units) {
    const g = growth(repeatTo(unit), (s) => mask(s, k));
    assert.ok(g < 10, `${JSON.stringify(unit)}: 4x input took ${g.toFixed(1)}x as long`);
  }
});

test('maskPath and maskBase run in linear time on long dot runs', () => {
  const k = buildIdentifiers({ home: '/Users/bob' });
  for (const build of [(n) => `${'.'.repeat(n)}x`, (n) => `/a/${'.'.repeat(n)}x`, (n) => `/a/x${'.'.repeat(n)}`]) {
    const g = growth(build, (s) => maskPath(s, k));
    assert.ok(g < 10, `4x input took ${g.toFixed(1)}x as long`);
  }
  const b = growth((n) => `a${'.'.repeat(n)}a`, maskBase);
  assert.ok(b < 10, `maskBase: 4x input took ${b.toFixed(1)}x as long`);
});

test('token-shaped scrub rules run in linear time on adversarial runs', () => {
  for (const unit of ['sk-', 'sk-ant-', 'ghp_', 'github_pat_', '-----BEGIN ', 'a://b:', 'ab+', 'Bearer ', 'eyJ', 'postgres://', 'AKIA', 'xoxb-', 'SG.', 'hvs.', 'Authorization: ', 'AccountKey=']) {
    const g = growth(repeatTo(unit));
    assert.ok(g < 10, `${unit}: 4x input took ${g.toFixed(1)}x as long`);
  }
});

test('the email, host, and IP rules still mask their shapes', () => {
  const k = buildIdentifiers({});
  assert.equal(mask('mail jane.doe+x@mail.acme.example.com or (ops@corp.io).', k), 'mail <email> or (<email>).');
  assert.equal(mask('hosts build01.acme.io, a.b.c.internal and x..api.dev', k), 'hosts <host>, <host> and x..<host>');
  assert.equal(mask('ip 10.1.2.3 and 255.255.255.0.', k), 'ip <ip> and <ip>.');
  assert.equal(mask('Run npm test; see README.md; v1.2.3 shipped.', k), 'Run npm test; see README.md; v1.2.3 shipped.');
});

test('scrub runs in linear time on adversarial key-like runs', () => {
  for (const unit of ['token-', 'a-token', 'password_', 'secret-key-', 'x-', 'mysql ', 'curl -u ']) {
    const g = growth((n) => unit.repeat(Math.ceil(n / unit.length)) + '=' + 'v'.repeat(20));
    assert.ok(g < 10, `${unit}: 4x input took ${g.toFixed(1)}x as long`);
  }
});

test('assignment scrub still catches keys inside longer names', () => {
  const v = 'Q'.repeat(6) + '7'.repeat(6);
  for (const s of [`MY_API_KEY=${v}`, `"db-password": "${v}"`, `x.auth_token:${v}`, `GITHUB_TOKEN=${v}`]) {
    assert.ok(!scrubSecrets(s).includes(v), s);
  }
});

test('short passwords in password assignments are scrubbed', () => {
  for (const s of ['password=hunter2', 'DB_PASS = s3cr', '"passwd": "abc12"', 'pwd: Xy9!']) {
    const v = s.split(/[:=]\s*"?/)[1].replace(/"$/, '');
    assert.ok(!scrubSecrets(s).includes(v), `${s} -> ${scrubSecrets(s)}`);
  }
});

test('new rules leave ordinary prose alone', () => {
  for (const s of [
    'Use your password manager; bypass the cache; compass: north',
    'Tests passes: 3 of 3. Set the Authorization header to a bearer token.',
    'Run mysql -u root -p to be prompted. curl -u needs user:password.',
    'SG.1 is a section; ya29 is a prefix. The auth flow is documented.',
  ]) assert.equal(scrubSecrets(s), s);
});

test('home paths keep only .claude and the file name', () => {
  const k = buildIdentifiers({ home: '/Users/jdoe', projects: ['payments-api'] });
  const s = '~/work/megaclient/payments-api/CLAUDE.md, /Users/jdoe/src/acme/app/.claude/settings.json, ~/.claude/CLAUDE.md';
  const out = mask(s, k);
  assert.ok(!/megaclient|acme|work|src|app\//.test(out), out);
  assert.equal(out, '~/<path>/CLAUDE.md, ~/<path>/.claude/settings.json, ~/.claude/CLAUDE.md');
  const deep = maskDeep({ anchor: '~/work/megaclient/x/CLAUDE.md' }, k);
  assert.equal(deep.anchor, '~/<path>/CLAUDE.md');
});

test('free-text home and absolute paths mask folders that contain spaces', () => {
  const k = buildIdentifiers({ home: '/Users/bob' });
  const out = mask('See ~/Client Work/acme-corp/svc/CLAUDE.md and /Library/Application Support/Zorb Co/x.json now', k);
  assert.ok(!/Client|Work|acme|svc|Application|Support|Zorb/.test(out), out);
  assert.equal(out, 'See ~/<path>/CLAUDE.md and <path>/<file>.json now');
});

test('free-text paths mask folders with punctuation and non-ASCII letters', () => {
  const k = buildIdentifiers({ osUser: 'bob', home: '/Users/bob', projects: ['repo'] });
  const cases = {
    'CLAUDE.md at /Users/bob/Clients/Acme & Sons (Legal)/repo/CLAUDE.md': 'CLAUDE.md at ~/<path>/CLAUDE.md',
    'see /Users/bob/Clients/Café Nordström/repo/CLAUDE.md': 'see ~/<path>/CLAUDE.md',
    "see /Users/bob/Bob's Clients/Contoso/repo/CLAUDE.md": 'see ~/<path>/CLAUDE.md',
    'see /Users/bob/Bob’s Clients/x.md': 'see ~/<path>/<file>.md',
    '/Volumes/Work/Acme, Inc/notes.md': '<path>/<file>.md',
    '/Users/bob/Clients/Acme Corp': '~/<path>/<file>',
    'at ~/Clients/Acme & Sons (Legal) today': 'at ~/<path>/<file> today',
    'see ~/Ünïcode Örg/über-app/x.js now': 'see ~/<path>/<file>.js now',
    'at /opt/Ünïcode Örg/Clïent/x.js': 'at <path>/<file>.js',
    'in /srv/Acme #1 [EU]/{tmp}/a+b=c%d/x.md.': 'in <path>/<file>.md.',
    'in C:\\Users\\bob\\Acme Co\\Kunde (alt)\\x.md here': 'in <path>/<file>.md here',
    'in D:/Work/Acme Co/x.md': 'in <path>/<file>.md',
    "(see /x/Acme Co/y.md) and '/srv/Zorb Co/z.txt' or \"/a/Zorb/b\"": "(see <path>/<file>.md) and '<path>/<file>.txt' or \"<path>/<file>\"",
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(mask(input, k), want, input);
});

test('the instruction file names stay whole in free text', () => {
  const k = buildIdentifiers({ home: '/Users/bob' });
  assert.equal(mask('Edit CLAUDE.local.md and settings.local.json now', k), 'Edit CLAUDE.local.md and settings.local.json now');
  assert.equal(mask('see /Users/bob/x/CLAUDE.local.md', k), 'see ~/<path>/CLAUDE.local.md');
  assert.equal(mask('host build.local is up', k), 'host <host> is up');
});

test('maskDeep masks path values under keys outside the path list', () => {
  const k = buildIdentifiers({ home: '/Users/bob', projects: ['repo'] });
  const p = '/Users/bob/Acme (Client)/repo';
  const out = maskDeep({ items: [{ line: 'x', paths: [`${p}/CLAUDE.md`, '/srv/Zorb Co/CLAUDE.md'] }, { root: p }], metric: { project: p }, cwds: [p], files: [`${p}/a b.md`] }, k);
  const text = JSON.stringify(out);
  for (const leak of ['Acme', 'Client', 'Zorb', 'a b']) assert.ok(!text.includes(leak), `${leak} leaked: ${text}`);
  assert.deepEqual(out.items[0].paths, ['~/<path>/CLAUDE.md', '<path>/CLAUDE.md']);
  assert.equal(out.items[1].root, '~/<path>/<project-1>');
});

test('maskPath masks path-typed fields segment by segment', () => {
  const k = buildIdentifiers({ home: '/Users/bob', projects: ['widget-api'] });
  const cases = {
    '/Users/bob/Mobile Documents/acme-corp/widget-api/CLAUDE.md': '~/<path>/CLAUDE.md',
    '~/My Drive/acme (old)/.claude/settings.json': '~/<path>/.claude/settings.json',
    '/Volumes/Data/acmeco/repo/CLAUDE.md': '<path>/CLAUDE.md',
    'svc/billing/CLAUDE.md': '<path>/CLAUDE.md',
    '.claude/settings.json': '.claude/settings.json',
    '~/.claude/CLAUDE.md': '~/.claude/CLAUDE.md',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(maskPath(input, k), want, input);
  assert.equal(maskPath('setup', k), 'setup');
  const deep = maskDeep({ integrity: { changed_paths: ['~/Client Work/acme/x.md'] }, skipped_files: [{ path_scrubbed: '~/A B/c d/e.md' }] }, k);
  assert.deepEqual(deep.integrity.changed_paths, ['~/<path>/<file>.md']);
  assert.equal(deep.skipped_files[0].path_scrubbed, '~/<path>/<file>.md');
});

test('displayPath only shortens the home at a path boundary', () => {
  assert.equal(displayPath('/Users/bobby/acmeco/CLAUDE.md', '/Users/bob'), '/Users/bobby/acmeco/CLAUDE.md');
  assert.equal(displayPath('/Users/bob/acmeco/CLAUDE.md', '/Users/bob'), '~/acmeco/CLAUDE.md');
  assert.equal(displayPath('/Users/bob', '/Users/bob'), '~');
});

test('round-2 rules leave ordinary prose alone', () => {
  for (const s of [
    'Log in with your password manager. Pass --password when prompted.',
    'The cookie banner text; Cookie: none set. Docker login asks for a password.',
    'Read the token docs and the sig= parameter. A dapi prefix and hvs. prefix exist.',
    'Use the authorization: bearer scheme. pypi-style names and the shpat prefix.',
    'The ATATT prefix marks Atlassian tokens; sntrys_ marks Sentry ones.',
  ]) assert.equal(scrubSecrets(s), s);
});

test('round-2 rules run in linear time on adversarial runs', () => {
  for (const unit of ['eyJ-', 'eyJabcdefgh.', 'Cookie: a=', 'login x password ', ' --password ', 'docker login ', '&sig=', 'token ', 'authorization: bearer ']) {
    const g = growth((n) => unit.repeat(Math.ceil(n / unit.length)));
    assert.ok(g < 10, `${unit}: 4x input took ${g.toFixed(1)}x as long`);
  }
});

test('share-safe basenames: tool file names and session ids stay, other names keep only the extension', () => {
  const known = buildIdentifiers({ home: '/home/u' });
  for (const name of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'MEMORY.md', 'SKILL.md', 'settings.json', 'settings.local.json', '.mcp.json', 'installed_plugins.json', '00000000-0000-4000-8000-000000000001.jsonl']) {
    assert.equal(maskPath(`/home/u/.claude/x/${name}`, known), `~/.claude/<path>/${name}`);
  }
  assert.equal(maskPath('/home/u/.claude/projects/p/memory/initechpayroll-contract-terms.md', known), '~/.claude/<path>/<file>.md');
  assert.equal(maskPath('docs/hooli-onboarding.md', known), '<path>/<file>.md');
  assert.equal(maskPath('/home/u/work/Makefile', known), '~/<path>/<file>');
  assert.equal(mask('See ~/.claude/commands/globex-release.md and /srv/acme/notes.txt.', known), 'See ~/.claude/<path>/<file>.md and <path>/<file>.txt.');
});
