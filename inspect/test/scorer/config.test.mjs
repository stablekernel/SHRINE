import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { score, findingId } from '../../src/scorer/score.mjs';
import { validateFindings } from '../../src/schema/findings.mjs';
import * as min from '../schema/minimal.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const catalogue = load('../../src/catalogue/catalogue.json');
const pivots = load('../../src/catalogue/generic-pivots.json');
const KINDS = load('../../src/catalogue/t0-kinds.json');

const stubCopy = {
  finding: (kind) => ({
    title: `title ${kind}`,
    short: `short ${kind}`,
    lead: `Lead for ${kind}. Second sentence.`,
    icon: 'wrench',
    why: ['w1', 'w2'],
    problem: ['p1', 'p2'],
    benefit: [{ headline: 'h', sub: 's' }],
  }),
  clear: (name) => ({ check: `check ${name}`, guards_against: `guards ${name}` }),
  unknowable: () => ['u1'],
};

const probe = (kind, hit, over = {}) => ({
  kind,
  entry_id: KINDS.kinds[kind].entry_ids[0],
  see_also: KINDS.kinds[kind].entry_ids.slice(1),
  hit,
  items: hit ? [{ path: '/home/u/.claude/CLAUDE.md', age_days: 200 }] : [],
  metric: {},
  ...over,
});
const allKinds = Object.keys(KINDS.kinds);
const structure = (pass = true) =>
  Object.keys(KINDS.structure).map((check) => ({ check, entry_id: KINDS.structure[check].entry_ids[0], applicable: true, pass, items: [] }));

function run(probes, extra = {}) {
  return score({
    run: min.run(),
    shrine: min.shrine(),
    probes,
    structure: structure(),
    catalogue,
    pivots,
    copy: stubCopy,
    inventoryCounts: { hooks: 2, skills: 0 },
    home: '/home/u',
    ...extra,
  });
}

const hitsOf = (...kinds) => allKinds.map((k) => probe(k, kinds.includes(k)));

test('output is a valid findings.json at schema_version 1', () => {
  const out = run(hitsOf('stale_instructions', 'blanket_permissions'));
  assert.deepEqual(validateFindings(out).errors, []);
  assert.equal(out.tier, 'T0');
});

test('config findings: confidence 0.9 high, harness, amplify, mechanical', () => {
  const all = run(hitsOf(...allKinds)).findings;
  assert.equal(all.length, allKinds.length);
  for (const f of all) {
    assert.equal(f.confidence.value, 0.9);
    assert.equal(f.confidence.label, 'high');
    assert.equal(f.attribution, 'harness');
    assert.equal(f.owner_label, 'Owner: Setup');
    assert.equal(f.tab, 'amplify');
    assert.equal(f.provenance, 'mechanical');
    assert.equal(f.pivot.source, 'shrine_generic');
  }
});

test('severity labels per spec 5', () => {
  const sev = Object.fromEntries(run(hitsOf(...allKinds)).findings.map((f) => [f.kind, f.severity.label]));
  assert.deepEqual(sev, {
    blanket_permissions: 'high',
    stale_instructions: 'medium',
    oversized_instructions: 'medium',
    no_owner_or_review: 'low',
    stack_gap: 'low',
    short_retention: 'low',
  });
});

test('a finding without entry_id is dropped', () => {
  const probes = hitsOf('stale_instructions');
  probes[0] = { ...probes[0], entry_id: null };
  const out = run(probes);
  assert.equal(out.findings.length, 0);
  assert.equal(out.dropped.length, 1);
  assert.match(out.dropped[0].reason, /entry_id/);
});

test('checked_clear holds every passing check with its SHRINE link', () => {
  const out = run(hitsOf('stale_instructions'));
  assert.equal(out.checked_clear.length, allKinds.length - 1 + 4);
  for (const c of out.checked_clear) {
    assert.ok(c.shrine_ref.url_pinned.startsWith('https://github.com/stablekernel/SHRINE/blob/'));
    assert.ok(c.guards_against);
  }
});

test('configured holds presence-only items and working stays empty', () => {
  const out = run(hitsOf());
  assert.deepEqual(out.configured, [{ item: 'hooks', count: 2 }]);
  assert.equal(out.findings.filter((f) => f.tab === 'working').length, 0);
  assert.equal(out.headline.counts.working, 0);
});

test('coverage counts by coverage_key: 7 principles, then each pattern and stack page, grouped', () => {
  const out = run(hitsOf('stale_instructions', 'no_owner_or_review', 'stack_gap'));
  const groups = (g) => out.coverage.filter((c) => c.group === g);
  assert.equal(groups('principles').length, 7);
  assert.equal(groups('patterns').length, catalogue.patterns.filter((p) => !p.id.endsWith('/overview')).length);
  assert.equal(groups('stack').length, catalogue.stack.filter((p) => !p.id.endsWith('/overview')).length);
  assert.ok(!out.coverage.some((c) => c.key === 'tokens-to-value' || c.key.endsWith('/overview')));
  const by = Object.fromEntries(out.coverage.map((c) => [c.key, c.amplify]));
  assert.equal(by['deliberate-currency'], 2);
  assert.equal(by['stack/harness'], 1, 'a stack-only citation counts under its own stack page');
});

test('see_also entries join shrine_refs and a principle among them sets coverage_key', () => {
  const f = run(hitsOf('blanket_permissions')).findings.find((x) => x.kind === 'blanket_permissions');
  assert.deepEqual(f.shrine_refs.map((r) => r.entry_id), ['tool-integration.ap.no-approval-step', 'human-in-the-loop.sov.undefined-boundary']);
  assert.equal(f.coverage_key, 'human-in-the-loop');
});

test('TLDR is the top 2 amplify by severity plus the third amplify', () => {
  const out = run(hitsOf('short_retention', 'stale_instructions', 'blanket_permissions', 'stack_gap'));
  assert.deepEqual(out.headline.tldr.map((t) => t.finding_id), out.findings.slice(0, 3).map((f) => f.id));
  assert.equal(out.findings[0].kind, 'blanket_permissions');
  assert.equal(out.findings[1].kind, 'stale_instructions');
  assert.equal(out.headline.tldr.length, 3);
  assert.ok(out.headline.tldr.every((t) => t.status === 'amplify'));
});

test('start_with is the highest severity, high confidence, 30 minutes or less', () => {
  const out = run(hitsOf('stack_gap', 'blanket_permissions'));
  assert.equal(out.headline.start_with.finding_id, out.findings.find((f) => f.kind === 'blanket_permissions').id);
  assert.equal(out.headline.start_with.minutes_to_apply, 10);
  assert.equal(out.headline.start_with.framed, true);
  assert.equal(run(hitsOf()).headline.start_with, null);
});

test('finding ids are stable across runs and match checked_clear ids when cleared', () => {
  const a = run(hitsOf('stale_instructions'));
  const b = run(hitsOf('stale_instructions'));
  assert.deepEqual(a.findings.map((f) => f.id), b.findings.map((f) => f.id));
  const cleared = run(hitsOf());
  const id = a.findings[0].id;
  assert.ok(cleared.checked_clear.some((c) => c.id === id));
  assert.equal(id, findingId('stale_instructions', KINDS.kinds.stale_instructions.entry_ids[0], 'setup'));
});

test('paths in evidence are scrubbed to the home marker', () => {
  const out = run(hitsOf('stale_instructions'));
  assert.equal(out.findings[0].evidence[0].locator, '~/.claude/CLAUDE.md');
});

test('without history the report notes it and the attribution stack is empty', () => {
  const out = run(hitsOf());
  assert.equal(out.attribution_stack, null);
  assert.equal(out.history.consented, false);
});

test('a probe that is not applicable is neither clear nor counts its area as checked', () => {
  const probes = hitsOf().map((p) => (p.kind === 'blanket_permissions' ? { ...p, applicable: false } : p));
  const out = run(probes, { structure: structure().map((s) => ({ ...s, applicable: false })) });
  assert.ok(!out.checked_clear.some((c) => c.entry_id === KINDS.kinds.blanket_permissions.entry_ids[0]));
  assert.equal(out.checked_clear.length, allKinds.length - 1);
  assert.equal(out.headline.counts.checks, allKinds.length - 1);
  const key = (k) => out.coverage.find((c) => c.key === k);
  assert.equal(key('stack/tool-integration').checked, false);
  assert.equal(key('human-in-the-loop').checked, false);
});

test('an area with a finding counts as checked even when no applicable check maps to it', () => {
  const probes = hitsOf('blanket_permissions').map((p) => (p.kind === 'blanket_permissions' ? { ...p, applicable: false } : p));
  const out = run(probes, { structure: [] });
  assert.ok(out.findings.some((f) => f.kind === 'blanket_permissions'));
  const withFinding = out.coverage.filter((c) => c.amplify + c.working > 0);
  assert.ok(withFinding.length > 0, 'some area has a finding');
  for (const c of withFinding) assert.equal(c.checked, true, c.key);
});

test('a failed structure check counts only when a finding cites its entry', () => {
  const failing = (names) => structure().map((s) => (names.includes(s.check) ? { ...s, pass: false } : s));
  const clean = run(hitsOf());
  const drift = run(hitsOf(), { structure: failing(['repo_layout']) });
  assert.equal(drift.headline.counts.checks, clean.headline.counts.checks - 1);
  assert.equal(drift.headline.counts.not_passed, 1);
  assert.equal(clean.headline.counts.not_passed, 0);
  assert.equal(drift.coverage.find((c) => c.key === 'consistency-as-leverage').checked, false);
  const blanket = run(hitsOf('blanket_permissions'), { structure: failing(['permissions_scoped']) });
  assert.equal(blanket.headline.counts.checks, clean.headline.counts.checks);
  assert.equal(blanket.headline.counts.not_passed, 0);
  assert.deepEqual(validateFindings(drift).errors, []);
});
