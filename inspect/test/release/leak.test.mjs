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
import { leaks, literals, shippedText, userMentions, wordRe } from '../../scripts/lib/leak.mjs';

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

test('a shipped string that ends inside a name does not hide the name', () => {
  const { chunks } = shippedText();
  const chunk = chunks.find((c) => /\s[a-z]{4,}$/.test(c) && c.length < 80 && !/[<>]/.test(c) && !page.includes(c));
  const last = chunk.match(/([a-z]+)$/)[1];
  const n = `${last}-billing`;
  const s = `${chunk.slice(0, -last.length)}${n}`;
  assert.deepEqual(leaks(page.replace('<body>', `<body><p>${s} repo</p>`), { names: [n] }), [`name: ${n}`], 'text');
  assert.deepEqual(leaks(plantJson(page, s), { names: [n] }), [`name: ${n}`], 'json');
  // The whole shipped string, alone, is still cut.
  assert.deepEqual(leaks(page.replace('<body>', `<body><p>${chunk}</p>`), { names: [last] }), []);
});

test('a name joined by underscore or camel case is found; a longer word is not', () => {
  for (const [s, n] of [['acme_billing', 'acme'], ['acmeBilling', 'acme'], ['billing_acme', 'acme'], ['billingAcme', 'Acme'], ['acme_Billing', 'acme']]) {
    assert.deepEqual(leaks(plantText(page, s), { names: [n] }), [`name: ${n}`], `text ${s}`);
    assert.deepEqual(leaks(plantJson(page, s), { names: [n] }), [`name: ${n}`], `json ${s}`);
  }
  for (const s of ['acmes', 'pacme', 'acme2', 'acme-billing']) assert.deepEqual(leaks(plantText(page, s), { names: ['acme'] }), [], s);
});

test('a prompt with quotes, ampersand, and a newline is found HTML- or JSON-escaped', () => {
  const p = 'Don\'t touch the "prod" config & rerun\nthen stop';
  const html = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  assert.deepEqual(leaks(page.replace('<body>', `<body><p>${html}</p>`), { prompts: [p] }), [`prompt: ${p}`], 'text');
  assert.deepEqual(leaks(page.replace('<body>', `<body><p>${html.replace('\n', '<br>\n  ')}</p>`), { prompts: [p] }), [`prompt: ${p}`], 'text, line break markup');
  assert.deepEqual(leaks(plantJson(page, p), { prompts: [p] }), [`prompt: ${p}`], 'json');
  const secret = 'sk-"a&b<c>\nd';
  assert.deepEqual(leaks(plantJson(page, secret), { secrets: [secret] }), ['secret: sk-"...'], 'secret json');
  assert.deepEqual(leaks(page, { prompts: [p], secrets: [secret] }), []);
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
  // The user stays a whole word: the CI user "runner" is not in the work order's "judge_runner".
  assert.deepEqual(userMentions('{"dispatcher": "judge_runner"}', 'runner'), []);
});

test('literals: string and template parts; comments and regex literals skipped', () => {
  const src = "// don't read me\nconst a = 'one two'; /* it's */ const r = /['\"]/g;\nconst t = `<p>${a ? `x ${b}` : 'y'} tail</p>`;";
  assert.deepEqual(literals(src), ['one two', '<p>', 'x ', '', 'y', ' tail</p>']);
});
