import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReport, shareSafeFindings, PREVIEW_LABEL } from '../../src/render/report.mjs';
import { buildIdentifiers } from '../../src/scrub/mask.mjs';
import { score } from '../../src/scorer/score.mjs';
import { copy } from '../../src/copy/templates.mjs';
import * as min from '../schema/minimal.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const mock = load('../fixtures/findings/mock-density.json');
const pivots = load('../../src/catalogue/generic-pivots.json');
const catalogue = load('../../src/catalogue/catalogue.json');
const KINDS = load('../../src/catalogue/t0-kinds.json');

const outsideScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');

function t0(hits = ['stale_instructions', 'blanket_permissions']) {
  const probes = Object.keys(KINDS.kinds).map((kind) => ({
    kind,
    entry_id: KINDS.kinds[kind].entry_ids[0],
    see_also: KINDS.kinds[kind].entry_ids.slice(1),
    hit: hits.includes(kind),
    items: [{ path: '/home/jdoe/.claude/CLAUDE.md', age_days: 200, rule: 'Bash', reason: 'blanket shell allow' }],
    metric: { count: 1, total: 2, max_age_days: 200, threshold_days: 180, kb: 1, threshold_kb: 40, days: 30, source: 'default', hooks: 1, skills: 1, memory: 1, missing: [] },
  }));
  const structure = Object.keys(KINDS.structure).map((check) => ({ check, entry_id: KINDS.structure[check].entry_ids[0], applicable: true, pass: true, items: [] }));
  return score({ run: min.run(), shrine: min.shrine(), probes, structure, catalogue, pivots, copy, home: '/home/jdoe' });
}

test('no external requests: no remote src, no stylesheet link, no remote url()', () => {
  for (const html of [renderReport(mock), renderReport(t0())]) {
    assert.ok(!/<link\b/i.test(html), 'no <link>');
    assert.ok(!/\bsrc\s*=\s*["']?https?:/i.test(html), 'no remote src');
    assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no remote url()');
    assert.ok(!/@import/i.test(html), 'no @import');
    // Every remaining http(s) string is a SHRINE navigation link, never a load.
    const rest = outsideScripts(html)
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/href="https:\/\/(stablekernel\.github\.io\/SHRINE|github\.com\/stablekernel\/SHRINE)\/[^"]*"/g, '');
    assert.ok(!/http/i.test(rest), rest.match(/.{40}http.{40}/i)?.[0]);
  }
});

test('embeds findings.json in a JSON data block', () => {
  const html = renderReport(mock);
  const m = html.match(/<script type="application\/json" id="findings-data">([\s\S]*?)<\/script>/);
  assert.deepEqual(JSON.parse(m[1]), mock);
});

test('every finding id appears outside scripts, so the report reads with scripts off', () => {
  const html = outsideScripts(renderReport(mock));
  for (const f of [...mock.findings, ...mock.worth_a_look]) assert.ok(html.includes(`id="${f.id}"`), f.id);
  for (const f of mock.findings) assert.ok(html.includes(f.title.replace(/&/g, '&amp;')), f.title);
  assert.ok(!/<div role="tabpanel"[^>]*hidden/.test(html), 'panels are not hidden in static HTML');
});

test('T0 depth band reads "Scan only, no model calls" and history not read', () => {
  const html = renderReport(t0());
  assert.match(html, /Scan only, no model calls/);
  assert.match(html, /history not read/);
  assert.match(html, /Needs Tier 1 or deeper/);
});

test('previous-run diff slot shows on a later run and is absent on a first run', () => {
  assert.match(renderReport(mock), /data-slot="diff">Since last run: 1 new, 1 cleared, 5 unchanged/);
  assert.ok(!renderReport(t0()).includes('data-slot="diff"'));
});

test('layout sections follow the mock', () => {
  const html = renderReport(mock);
  const order = ['class="head"', 'class="depth"', 'id="tldr-h"', 'Start with one change', 'class="cov"', 'class="attr"', 'role="tablist"', 'class="detail"', 'id="clear-h"', 'id="app-h"', 'class="foot"'];
  let pos = -1;
  for (const marker of order) {
    const i = html.indexOf(marker, pos + 1);
    assert.ok(i > pos, `${marker} out of order`);
    pos = i;
  }
  assert.match(html, /aria-controls="panel-amplify"/);
  assert.match(html, /ArrowRight/);
});

test('toggle label and share-safe file', () => {
  assert.ok(renderReport(mock).includes(PREVIEW_LABEL));
  assert.equal(PREVIEW_LABEL, 'Preview only. To share, use the share-safe file.');
  const known = buildIdentifiers({ osUser: 'jdoe', home: '/home/jdoe', projects: ['shop-api'], authors: [{ name: 'Jane Doe', email: 'jane@acme.example' }] });
  const raw = structuredClone(mock);
  raw.findings[0].evidence[1].excerpt_scrubbed = 'jdoe said: Done, the retry is in place.';
  raw.findings[2].evidence[0].locator = '/home/jdoe/.claude/settings.json';
  raw.run.scope.projects = ['shop-api'];
  raw.findings[3].why[1] = 'Jane Doe wrote shop-api rules.';
  const safe = shareSafeFindings(raw, known, pivots);
  const html = renderReport(safe, { shareSafe: true });
  assert.ok(!html.includes('the retry is in place'), 'excerpt removed');
  assert.ok(!html.includes('Prompt: add retry to sync job'), 'timeline label replaced');
  assert.ok(!html.includes('Add retry to the sync job.'), 'user prompt before/after replaced');
  for (const id of ['jdoe', 'Jane Doe', 'jane@acme.example', 'shop-api', '/home/jdoe']) assert.ok(!html.includes(id), id);
  assert.ok(!html.includes(PREVIEW_LABEL));
  assert.match(html, /Share-safe copy/);
  for (const f of safe.findings) for (const e of f.evidence) assert.equal(e.excerpt_scrubbed ?? null, null);
});

test('print CSS expands tabs and details', () => {
  const html = renderReport(mock);
  const print = html.slice(html.indexOf('@media print'));
  assert.match(print, /\[hidden\] \{ display: block !important; \}/);
  assert.match(print, /\.tabs, \.list/);
  assert.match(print, /break-before: page/);
});

test('style tokens are derived from the docs theme', () => {
  const shrine = readFileSync(fileURLToPath(new URL('../../../docs/src/styles/shrine.css', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../../src/render/assets/styles.css', import.meta.url)), 'utf8');
  const dark = shrine.match(/--sl-color-bg: (#[0-9a-f]{6});/)[1];
  const light = [...shrine.matchAll(/--sl-color-bg: (#[0-9a-f]{6});/g)][1][1];
  for (const v of [dark, light, '#00ced1', '#0d9488', '#0d3b4c', '#ccfbf1', '#2d3f4f', '#e2e8f0']) assert.ok(css.includes(v), v);
});

test('integrity failure renders a red banner naming paths', () => {
  const bad = structuredClone(mock);
  bad.integrity = { ok: false, changed_paths: ['~/.claude/settings.json'] };
  assert.match(renderReport(bad), /role="alert"><b>Integrity check failed\.<\/b>[^<]*<code class="mono">~\/\.claude\/settings\.json/);
});

test('T2-size fixture renders under 300 KB', () => {
  assert.ok(Buffer.byteLength(renderReport(mock)) < 300 * 1024);
});

test('coverage shows only tripped areas, grouped by SHRINE area, plus one quiet line', () => {
  const d = t0(['stale_instructions', 'blanket_permissions', 'stack_gap']);
  const html = renderReport(d);
  const cov = html.slice(html.indexOf('id="map-h"'), html.indexOf('class="attr"'));
  const rows = [...cov.matchAll(/<th scope="row"[^>]*>[\s\S]*?<\/svg> ([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['Human in the Loop', 'Deliberate Currency', 'Harness Selection']);
  assert.deepEqual([...cov.matchAll(/scope="rowgroup" colspan="3"[^>]*>(\w+)</g)].map((m) => m[1]), ['Principles', 'Stack']);
  assert.match(cov, new RegExp(`${d.coverage.length - 3} other areas showed no findings`));
  assert.ok(!cov.includes('Authority Cascade'), 'clean areas are hidden');
  for (const role of ['table', 'rowgroup', 'row', 'columnheader', 'rowheader', 'cell']) assert.ok(cov.includes(`role="${role}"`), `role ${role} kept for the phone grid layout`);
});

test('coverage with no finding shows only the quiet line', () => {
  const html = renderReport(t0([]));
  const cov = html.slice(html.indexOf('id="map-h"'), html.indexOf('class="attr"'));
  assert.ok(!cov.includes('<table'));
  assert.match(cov, /No SHRINE area showed a finding \(\d+ areas checked\)/);
});
