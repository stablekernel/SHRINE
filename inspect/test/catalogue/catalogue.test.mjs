import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harvestSection, parsePage, normalize, slug } from '../../src/catalogue/harvest.mjs';
import { buildCatalogue } from '../../src/catalogue/build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const repoDocs = join(here, '..', '..', '..', 'docs', 'src', 'content', 'docs');
const read = (p) => readFileSync(join(fixtures, p), 'utf8');

test('bullets under an H2 are harvested until the next H2', () => {
  const page = parsePage(read('docs/principles/deliberate-currency.md'), 'principles/deliberate-currency');
  const entries = harvestSection(page, 'Signal of Violation', { shape: 'bullets' });
  assert.equal(entries.length, 2);
  assert.match(entries[0].text, /^Drift: skills tuned/);
  assert.equal(entries[0].anchor, 'signal-of-violation');
});

test('table rows with exactly 3 cells are harvested', () => {
  const page = parsePage(read('docs/reference/anti-patterns.md'), 'reference/anti-patterns');
  const rows = harvestSection(page, 'Drift and Currency', { shape: 'table', cells: 3 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].cells.slice(0, 2), ['Plausible code that does not run', 'No check before done']);
});

test('a row with the wrong cell count throws with page and line', () => {
  const md = '---\ntitle: X\n---\n\n## G\n\n| A | B | C |\n|---|---|---|\n| a | b |\n';
  assert.throws(() => harvestSection(parsePage(md, 'reference/x'), 'G', { shape: 'table', cells: 3 }), /reference\/x:9/);
});

test('any other shape under a harvested heading throws with page and line', () => {
  const md = readFileSync(join(fixtures, 'docs-malformed/principles/broken.md'), 'utf8');
  assert.throws(
    () => harvestSection(parsePage(md, 'principles/broken'), 'Signal of Violation', { shape: 'bullets' }),
    /principles\/broken:9: unexpected shape/,
  );
});

test('a missing harvested heading throws', () => {
  const page = parsePage(read('docs/stack/harness.md'), 'stack/harness');
  assert.throws(() => harvestSection(page, 'Signal of Violation', { shape: 'bullets' }), /stack\/harness: no "Signal of Violation"/);
});

test('normalize strips markdown and case', () => {
  assert.equal(normalize('`Make it`  work as the *only* [criterion](/x/)'), 'make it work as the only criterion');
  assert.equal(slug('Signal of Violation'), 'signal-of-violation');
  assert.equal(slug('Drift and Currency'), 'drift-and-currency');
});

const fixtureIds = {
  'deliberate-currency.sov.drift': {
    page_id: 'principles/deliberate-currency',
    anchor: 'signal-of-violation',
    match: 'drift: skills tuned',
  },
};

test('build covers principle, pattern, stack, index, overview symptoms, and glossary', () => {
  const cat = buildCatalogue({ docsDir: join(fixtures, 'docs'), entryIds: fixtureIds, commit: 'f'.repeat(40) });
  assert.equal(cat.schema_version, 1);
  assert.equal(cat.principles[0].signals_of_violation.length, 2);
  assert.equal(cat.patterns.find((p) => p.id === 'patterns/verification-loops').anti_patterns.length, 2);
  assert.equal(cat.stack[0].status, 'draft');
  assert.equal(cat.anti_patterns.length, 2);
  assert.deepEqual(cat.anti_patterns[1].fix_links, [
    { page_id: 'patterns/verification-loops', anchor: 'anti-patterns' },
    { page_id: 'stack/harness', anchor: '' },
  ]);
  assert.equal(cat.symptoms.length, 2, 'patterns/overview symptom table harvested');
  assert.equal(cat.glossary[0].term, 'Compaction');
  assert.equal(cat.shrine.files['principles/deliberate-currency.md'].length, 64);
});

test('unmapped entries get page id plus a hash of normalized text', () => {
  const cat = buildCatalogue({ docsDir: join(fixtures, 'docs'), entryIds: fixtureIds, commit: 'f'.repeat(40) });
  const churn = cat.principles[0].signals_of_violation[1];
  assert.match(churn.entry_id, /^principles\/deliberate-currency#[0-9a-f]{10}$/);
});

test('mapped ids resolve to one entry with a pinned quote', () => {
  const cat = buildCatalogue({ docsDir: join(fixtures, 'docs'), entryIds: fixtureIds, commit: 'f'.repeat(40) });
  const e = cat.entries['deliberate-currency.sov.drift'];
  assert.equal(e.section, 'principle');
  assert.equal(e.status, 'ratified');
  assert.match(e.quote, /^Drift: skills tuned/);
  assert.match(e.url_pinned, /ffffffff/);
  assert.equal(cat.principles[0].signals_of_violation[0].entry_id, 'deliberate-currency.sov.drift');
});

test('build fails when a mapped id resolves to zero or two entries', () => {
  const none = { x: { page_id: 'principles/deliberate-currency', anchor: 'signal-of-violation', match: 'nothing like this' } };
  const two = { x: { page_id: 'principles/deliberate-currency', anchor: 'signal-of-violation', match: '' } };
  assert.throws(() => buildCatalogue({ docsDir: join(fixtures, 'docs'), entryIds: none, commit: 'c' }), /resolves to 0/);
  assert.throws(() => buildCatalogue({ docsDir: join(fixtures, 'docs'), entryIds: two, commit: 'c' }), /resolves to 2/);
});

test('golden: build over the repo docs equals the committed golden and bundled catalogue', () => {
  const golden = JSON.parse(readFileSync(join(here, '..', 'golden', 'catalogue.json'), 'utf8'));
  const bundled = JSON.parse(readFileSync(join(here, '..', '..', 'src', 'catalogue', 'catalogue.json'), 'utf8'));
  const built = buildCatalogue({ docsDir: repoDocs, commit: golden.shrine.commit });
  assert.deepEqual(built, golden);
  assert.deepEqual(bundled, golden);
});
