import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scrubSecrets } from '../../src/scrub/secrets.mjs';
import { plantedCorpus } from '../synth/secrets.mjs';
import { buildIdentifiers, mask, maskDeep } from '../../src/scrub/mask.mjs';

const corpus = plantedCorpus();
const body = corpus
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n');
const STOP = new Set(['Authorization', 'DefaultEndpointsProtocol', 'EndpointSuffix']);
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
  assert.match(out, /~\/work\/<project-1>\/CLAUDE\.md/);
  assert.match(out, /<email>/);
  assert.match(out, /<host>/);
  assert.match(out, /<ip>/);
});

test('mask covers encoded project folders and dashed user names', () => {
  const k = buildIdentifiers({ home: '/Users/j.doe' });
  const out = mask('~/.claude/projects/-Users-j-doe-src-acme-shop/memory/MEMORY.md and ~/src/github/j-doe/x', k);
  assert.ok(!/j-doe|acme|shop/.test(out), out);
  assert.match(out, /\.claude\/projects\/<project-folder>\/memory/);
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

test('scrub runs in linear time on adversarial key-like runs', () => {
  for (const unit of ['token-', 'a-token', 'password_', 'secret-key-', 'x-', 'mysql ', 'curl -u ']) {
    const s = unit.repeat(Math.ceil(20000 / unit.length)) + '=' + 'v'.repeat(20);
    const t = performance.now();
    scrubSecrets(s);
    const ms = performance.now() - t;
    assert.ok(ms < 50, `${unit}: ${ms.toFixed(0)}ms`);
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
