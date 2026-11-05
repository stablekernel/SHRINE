// Zero-history end-to-end goldens (plan T1.15). Regenerate after a reviewed
// change with: UPDATE_GOLDEN=1 node scripts/test.mjs zero-history
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const GOLDEN = fileURLToPath(new URL('../golden/', import.meta.url));
const FIXED_DATES = new Set(['2025-01-15T09:00:00.000Z', '2026-10-25T09:00:00.000Z']);

async function runT0(fixture) {
  const h = makeHome(fixture);
  const state = mkdtempSync(join(tmpdir(), 'si-zh-'));
  const out = [];
  const err = [];
  const t0 = performance.now();
  const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
    env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    home: h.home,
    stdin: { isTTY: false },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  const ms = performance.now() - t0;
  assert.equal(code, 0, err.join(''));
  const s = JSON.parse(out.join(''));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const html = readFileSync(s.report, 'utf8');
  h.cleanup();
  return { h, findings, html, ms };
}

// Replace run-specific values (temp paths, run id, copy-time mtimes) with markers.
function normalize(findings, h) {
  const text = JSON.stringify(findings).split(h.tmp).join('<tmp>');
  return JSON.parse(text, (k, v) => {
    if (k === 'id' && typeof v === 'string' && /^\d{8}-\d{6}Z-/.test(v)) return '<run-id>';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !FIXED_DATES.has(v) && v !== FIXED_NOW) return '<copy-time>';
    return v;
  });
}

function golden(name, actual) {
  const path = join(GOLDEN, name, 'findings.json');
  if (process.env.UPDATE_GOLDEN || !existsSync(path)) {
    mkdirSync(join(GOLDEN, name), { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  }
  assert.deepEqual(actual, JSON.parse(readFileSync(path, 'utf8')));
}

test('good setup, zero history: useful report, every passing check listed, no amplify above low', async () => {
  const { h, findings, html, ms } = await runT0('good');
  assert.ok(ms < 5000, `runtime ${ms} ms`);
  assert.ok(findings.findings.every((f) => f.tab !== 'amplify' || f.severity.label === 'low'));
  const passing = findings.headline.counts.checks - findings.findings.length;
  assert.equal(findings.checked_clear.length, passing);
  assert.ok(findings.checked_clear.length >= 8, 'non-empty report');
  assert.match(html, /Checked and clear/);
  assert.match(html, /Needs Tier 1 or deeper/);
  assert.match(html, /Scan only, no model calls/);
  assert.ok(findings.unknowable.some((u) => /Tier 1 or deeper/.test(u)), 'deeper-tier note');
  golden('zero-history-good', normalize(findings, h));
});

test('bad setup: stale, blanket, oversized, stack_gap surface as mechanical findings; zero praise', async () => {
  const { h, findings, ms } = await runT0('bad');
  assert.ok(ms < 5000, `runtime ${ms} ms`);
  const kinds = findings.findings.map((f) => f.kind);
  for (const k of ['stale_instructions', 'blanket_permissions', 'oversized_instructions', 'stack_gap']) assert.ok(kinds.includes(k), k);
  assert.ok(findings.findings.every((f) => f.provenance === 'mechanical'));
  assert.ok(findings.findings.every((f) => f.tab !== 'working' && f.praise_class === null));
  assert.equal(findings.headline.counts.working, 0);
  assert.equal(findings.headline.start_with.finding_id, findings.findings.find((f) => f.kind === 'blanket_permissions').id);
  golden('bad-setup', normalize(findings, h));
});
