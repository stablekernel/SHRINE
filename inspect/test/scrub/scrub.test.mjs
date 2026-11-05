import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scrubSecrets } from '../../src/scrub/secrets.mjs';
import { plantedCorpus } from '../synth/secrets.mjs';
import { buildIdentifiers, mask, maskDeep, maskPath } from '../../src/scrub/mask.mjs';
import { displayPath } from '../../src/scorer/score.mjs';

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

// Linear-time check that does not flake under CPU load: compares the time at 4x the
// input with the time at 1x, best of 5 each, runs interleaved so load spikes hit
// both sizes. Linear rules give about 4; a quadratic one gives about 16.
function growth(build) {
  const time = (s) => {
    const t = performance.now();
    scrubSecrets(s);
    return performance.now() - t;
  };
  const small = build(20000);
  const large = build(80000);
  time(small);
  let a = Infinity;
  let b = Infinity;
  for (let i = 0; i < 5; i++) {
    a = Math.min(a, time(small));
    b = Math.min(b, time(large));
  }
  return b / Math.max(a, 0.5);
}

test('scrub runs in linear time on adversarial key-like runs', () => {
  for (const unit of ['token-', 'a-token', 'password_', 'secret-key-', 'x-', 'mysql ', 'curl -u ']) {
    const g = growth((n) => unit.repeat(Math.ceil(n / unit.length)) + '=' + 'v'.repeat(20));
    assert.ok(g < 8, `${unit}: 4x input took ${g.toFixed(1)}x as long`);
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
  assert.equal(out, 'See ~/<path>/CLAUDE.md and <path>/x.json now');
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
  assert.deepEqual(deep.integrity.changed_paths, ['~/<path>/x.md']);
  assert.equal(deep.skipped_files[0].path_scrubbed, '~/<path>/e.md');
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
    assert.ok(g < 8, `${unit}: 4x input took ${g.toFixed(1)}x as long`);
  }
});
