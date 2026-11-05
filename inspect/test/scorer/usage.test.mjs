import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { controlTest, usageConfidence, usageSeverity, historyRule, tierProposal } from '../../src/scorer/stats.mjs';
import { score } from '../../src/scorer/score.mjs';
import { copy, SAMPLE_USAGE } from '../../src/copy/templates.mjs';
import { THRESHOLDS } from '../../src/probes/config.mjs';
import { validateFindings } from '../../src/schema/findings.mjs';
import { copyProblemsDeep } from '../../src/copy/rules.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const catalogue = load('../../src/catalogue/catalogue.json');
const pivots = load('../../src/catalogue/generic-pivots.json');
const K = load('../../src/catalogue/t0-kinds.json');
const t = THRESHOLDS;

test('confidence table: 0.6 base, +0.05 per hit above bar, +0.1 beating control, max 0.85, candidates capped at medium', () => {
  const rows = [
    [{ hitsAboveBar: 0, beatsControl: false }, 0.6, 'medium'],
    [{ hitsAboveBar: 2, beatsControl: false }, 0.7, 'medium'],
    [{ hitsAboveBar: 2, beatsControl: true }, 0.8, 'high'],
    [{ hitsAboveBar: 10, beatsControl: true }, 0.85, 'high'],
    [{ hitsAboveBar: 10, beatsControl: true, candidates: true }, 0.74, 'medium'],
    [{ hitsAboveBar: -3, beatsControl: false }, 0.6, 'medium'],
  ];
  for (const [input, value, label] of rows) assert.deepEqual(usageConfidence(input, t), { value, label }, JSON.stringify(input));
});

test('control: under 15 other episodes is "no control baseline"; beating needs the threshold in points', () => {
  const c = (fn, rn, diff) => ({ flagged: { hits: 1, n: fn, rate: 0 }, rest: { hits: 1, n: rn, rate: 0 }, diff_points: diff });
  assert.equal(controlTest(c(5, 14, 40), { minN: 15, points: 10 }).status, 'no_control_baseline');
  assert.equal(controlTest(c(5, 14, 40), { minN: 15, points: 10 }).beats, false);
  assert.deepEqual(controlTest(c(5, 15, 10), { minN: 15, points: 10 }), { status: 'ok', beats: true, diff_points: 10 });
  assert.equal(controlTest(c(5, 40, 9.9), { minN: 15, points: 10 }).beats, false);
  assert.equal(controlTest(null, { minN: 15, points: 10 }).status, 'none');
});

test('severity bands per 10 episodes, provisional; a flagged group under 15 episodes is capped at low', () => {
  assert.equal(usageSeverity({ tokens: 100000, episodes: 20, flaggedN: 20 }, t).label, 'high');
  assert.equal(usageSeverity({ tokens: 40000, episodes: 20, flaggedN: 20 }, t).label, 'medium');
  assert.equal(usageSeverity({ tokens: 1000, episodes: 20, flaggedN: 20 }, t).label, 'low');
  const small = usageSeverity({ tokens: 900000, episodes: 14, flaggedN: 14 }, t);
  assert.deepEqual([small.label, small.capped], ['low', true]);
});

test('history-size rules apply in order; tier proposal is capped at T0', () => {
  assert.equal(historyRule({ consented: false, sessions: 50 }, t), 'setup_only');
  assert.equal(historyRule({ consented: true, sessions: 0 }, t), 'setup_only');
  assert.equal(historyRule({ consented: true, sessions: 9 }, t), 'limited');
  assert.equal(historyRule({ consented: true, sessions: 10 }, t), 'probe');
  assert.equal(tierProposal('probe'), 'T0');
});

const run = { id: 'r', started_at: '2026-11-04T12:00:00.000Z', tool_version: '0.1.0', harness: { name: 'Claude Code', version: '2.1.318' }, scope: { projects: ['p'], from: null, to: null, history_consented: true }, win_definition: null, seed: null };
const base = (usage, thresholds = t) =>
  score({ run, shrine: { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null }, probes: [], structure: [], catalogue, pivots, copy, history: { consented: true, read: true, sessions: usage.counts.sessions }, usage, usageKinds: K.usage_kinds, thresholds });
const usageOf = (rule, flagged = 20, rest = 40) => ({
  ...SAMPLE_USAGE,
  rule,
  counts: { ...SAMPLE_USAGE.counts, sessions: rule === 'limited' ? 5 : 66 },
  kinds: [{ kind: 'done_without_test', ship: 'appendix', hit: true, metric: { flagged, claims: flagged + 2, rate: flagged / (flagged + 2), threshold: 0.3 }, control: { flagged: { hits: flagged, n: flagged, rate: 1 }, rest: { hits: 0, n: rest, rate: 0 }, diff_points: 100 }, tokens: flagged * 9000, episode_ids: ['e-1'] }],
});

test('appendix mode (shipped): zero usage findings; counts, chips, and lines in the usage block', () => {
  const f = base(usageOf('probe'));
  assert.equal(f.findings.length, 0);
  assert.equal(f.headline.counts.correction_candidates, SAMPLE_USAGE.counts.correction_candidates);
  assert.equal(f.headline.counts.sessions, 66);
  assert.ok(f.usage.lines.some((l) => /Count only/.test(l)));
  assert.ok(f.thresholds.done_claims_without_test_pct === 30);
  assert.deepEqual(validateFindings(f).errors, []);
  assert.deepEqual(copyProblemsDeep(f.usage.lines), []);
});

test('candidates mode: a usage finding with attribution unknown, confidence capped at medium, severity by N', () => {
  const tc = structuredClone(t);
  tc.usage.done_without_test.ship = 'candidates';
  const u = usageOf('probe');
  u.kinds[0].ship = 'candidates';
  const f = base(u, tc);
  assert.equal(f.findings.length, 1);
  const x = f.findings[0];
  assert.equal(x.lens, 'usage');
  assert.equal(x.attribution, 'unknown');
  assert.equal(x.confidence.label, 'medium');
  assert.equal(x.severity.label, 'high', '20 flagged episodes at 9K tokens each');
  assert.match(x.title, /candidates/);
  assert.deepEqual(validateFindings(f).errors, []);
  const small = usageOf('probe', 6);
  small.kinds[0].ship = 'candidates';
  assert.equal(base(small, tc).findings[0].severity.label, 'low', 'under 15 flagged episodes caps at low');
});

test('thin window: under 10 sessions gives counts only and a limited-history note, even in candidates mode', () => {
  const u = usageOf('limited');
  u.kinds[0].ship = 'candidates';
  const f = base(u);
  assert.equal(f.findings.length, 0);
  assert.match(f.notes.join(' '), /Limited history/);
  assert.equal(f.usage.limited, true);
});

test('config strip: sessions since counts only sessions where that config was live, and is hidden with no date', () => {
  const kinds = Object.keys(K.kinds);
  const probe = (kind, item) => ({ kind, entry_id: K.kinds[kind].entry_ids[0], see_also: [], hit: true, items: [item], metric: {} });
  const sessions = [
    { start: '2026-10-05T10:00:00Z', root: '/w/a' },
    { start: '2026-10-06T10:00:00Z', root: '/w/b' },
    { start: '2026-09-01T10:00:00Z', root: '/w/a' },
  ];
  const f = score({
    run,
    shrine: { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null },
    probes: [
      probe(kinds[0], { path: '/w/a/CLAUDE.md', date: '2026-10-01', date_source: 'git' }),
      probe(kinds[1], { path: '/home/u/.claude/settings.json', date: '2026-10-01', date_source: 'git' }),
      probe(kinds[2], { path: '/w/c/.claude/settings.json', date: null, date_source: 'none' }),
    ],
    structure: [],
    catalogue,
    pivots,
    copy,
    home: '/home/u',
    history: { consented: true, read: true, sessions: 3 },
    sessionStarts: sessions,
    projectScopes: ['/w/a', '/w/b', '/w/c'].map((root) => ({ root, memory_dirs: [`/home/u/.claude/projects/${root.replace(/\//g, '-')}/memory`], loaded: [] })),
  });
  const strip = (k) => f.findings.find((x) => x.kind === k).config_strip;
  assert.equal(strip(kinds[0]).sessions_since, 1, 'project config: that project only');
  assert.equal(strip(kinds[1]).sessions_since, 2, 'user-global config: every project');
  assert.equal(strip(kinds[2]).sessions_since, null, 'no date: no figure');
  assert.deepEqual(validateFindings(f).errors, []);
});

test('config strip: auto-memory counts its own project; an import outside any root counts its importers', () => {
  const kinds = Object.keys(K.kinds);
  const probe = (kind, item) => ({ kind, entry_id: K.kinds[kind].entry_ids[0], see_also: [], hit: true, items: [item], metric: {} });
  const sessions = [
    { start: '2026-10-05T10:00:00Z', root: '/w/a' },
    { start: '2026-10-06T10:00:00Z', root: '/w/b' },
    { start: '2026-10-07T10:00:00Z', root: '/w/b' },
  ];
  const f = score({
    run,
    shrine: { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null },
    probes: [
      probe(kinds[0], { path: '/home/u/.claude/projects/-w-a/memory/MEMORY.md', date: '2026-10-01', date_source: 'mtime' }),
      probe(kinds[1], { path: '/home/u/notes/shared.md', date: '2026-10-01', date_source: 'mtime' }),
      probe(kinds[2], { path: '/elsewhere/orphan.md', date: '2026-10-01', date_source: 'mtime' }),
    ],
    structure: [],
    catalogue,
    pivots,
    copy,
    home: '/home/u',
    history: { consented: true, read: true, sessions: 3 },
    sessionStarts: sessions,
    projectScopes: [
      { root: '/w/a', memory_dirs: ['/home/u/.claude/projects/-w-a/memory'], loaded: [] },
      { root: '/w/b', memory_dirs: ['/home/u/.claude/projects/-w-b/memory'], loaded: ['/home/u/notes/shared.md'] },
    ],
  });
  const strip = (k) => f.findings.find((x) => x.kind === k).config_strip;
  assert.equal(strip(kinds[0]).sessions_since, 1, 'memory of /w/a: /w/a sessions only');
  assert.equal(strip(kinds[1]).sessions_since, 2, 'imported by /w/b only');
  assert.equal(strip(kinds[2]).sessions_since, null, 'loaded nowhere known: no figure');
});

test('config strip: sessions since compares instants, not ISO text with mixed offsets', () => {
  const kinds = Object.keys(K.kinds);
  // The change is 2026-10-05T15:00Z (git %cI gives a local offset); the session started 3 hours before it.
  const f = score({
    run,
    shrine: { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null },
    probes: [{ kind: kinds[0], entry_id: K.kinds[kinds[0]].entry_ids[0], see_also: [], hit: true, items: [{ path: '/w/a/CLAUDE.md', date: '2026-10-05T10:00:00-05:00', date_source: 'git' }], metric: {} }],
    structure: [],
    catalogue,
    pivots,
    copy,
    home: '/home/u',
    history: { consented: true, read: true, sessions: 2 },
    sessionStarts: [
      { start: '2026-10-05T12:00:00Z', root: '/w/a' },
      { start: '2026-10-05T16:00:00Z', root: '/w/a' },
    ],
    projectScopes: [{ root: '/w/a', memory_dirs: [], loaded: [] }],
  });
  assert.equal(f.findings.find((x) => x.kind === kinds[0]).config_strip.sessions_since, 1);
});
