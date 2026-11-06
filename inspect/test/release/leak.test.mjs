// Leak check (scripts/lib/leak.mjs) on a share-safe page rendered from the
// bad-setup golden findings (real pipeline output): project
// names that are ordinary words in the page's own text ("SHRINE", "scope",
// "nothing") are not leaks, yet the same words planted where data goes are
// found. The OS user "root" is not the stylesheet's :root or the shipped
// script's `var root`, yet is found in page text and in the findings JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../../src/render/report.mjs';
import { leaks, literals, userMentions, wordRe } from '../../scripts/lib/leak.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../golden/bad-setup/findings.json', import.meta.url)), 'utf8'));
const page = renderReport(golden, { shareSafe: true });
// Five of the nine words a real run reported as leaks: project folder names
// that also sit in catalogue text, copy, markup, or the findings JSON.
const ORDINARY = ['SHRINE', 'scope', 'table', 'nothing', 'deleted'];
const plantJson = (html, n) => html.replace(/(<script type="application\/json"[^>]*>\{)/, `$1"planted":${JSON.stringify(n)},`);
const plantText = (html, n) => html.replace('<body>', `<body><p>Data from ${n} and two other projects.</p>`);

test('ordinary words the page itself ships are not project-name leaks', () => {
  for (const w of ORDINARY) assert.match(page, wordRe(w), `${w} is on the page`);
  assert.deepEqual(leaks(page, { names: ORDINARY }), []);
});

test('the same words planted in page text or the findings JSON are found', () => {
  for (const n of ['SHRINE', 'scope', 'acme-billing']) {
    assert.deepEqual(leaks(plantText(page, n), { names: [n] }), [`name: ${n}`], `text ${n}`);
    assert.deepEqual(leaks(plantJson(page, n), { names: [n] }), [`name: ${n}`], `json ${n}`);
  }
  // A word inside a longer, unshipped run still counts.
  assert.deepEqual(leaks(page.replace('<body>', '<body><li>skills: 3 in skills-repo and skills</li>'), { names: ['skills'] }), ['name: skills']);
});

test('a configured count label ("skills: 112") is not a leak; the bare word is', () => {
  const html = (body, data = {}) => `<html><body>${body}<script type="application/json" id="findings-data">${JSON.stringify(data)}</script></body></html>`;
  assert.deepEqual(leaks(html('<ul><li>skills: 112</li></ul>', { configured: [{ item: 'skills', count: 112 }] }), { names: ['skills'] }), []);
  assert.deepEqual(leaks(html('<ul><li>skills</li></ul>'), { names: ['skills'] }), ['name: skills']);
  assert.deepEqual(leaks(html('', { scope: { projects: ['skills'] } }), { names: ['skills'] }), ['name: skills']);
});

test('OS user root: CSS selectors and the shipped script are not the user; anywhere else is', () => {
  assert.match(page, /:root/);
  assert.match(page, /var root/);
  assert.deepEqual(userMentions(page, 'root'), []);
  assert.deepEqual(leaks(page, { user: 'root' }), []);
  assert.deepEqual(leaks(plantText(page, 'root'), { user: 'root' }), ['user name']);
  assert.deepEqual(leaks(plantJson(page, 'root'), { user: 'root' }), ['user name']);
  // Not a selector: a property value inside <style>, or a script that is not the shipped one.
  assert.deepEqual(leaks(page.replace('</style>', 'p::after { content: "root"; }</style>'), { user: 'root' }), ['user name']);
  assert.deepEqual(leaks(page.replace('<body>', '<body><script>var who = "root";</script>'), { user: 'root' }), ['user name']);
});

test('literals: string and template parts; comments and regex literals skipped', () => {
  const src = "// don't read me\nconst a = 'one two'; /* it's */ const r = /['\"]/g;\nconst t = `<p>${a ? `x ${b}` : 'y'} tail</p>`;";
  assert.deepEqual(literals(src), ['one two', '<p>', 'x ', '', 'y', ' tail</p>']);
});
