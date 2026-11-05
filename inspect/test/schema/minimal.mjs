// Minimal spec-legal objects shared by schema tests.
export const run = () => ({
  id: 'r1',
  started_at: '2026-11-04T10:00:00.000Z',
  tool_version: '0.1.0',
  harness: { name: 'Claude Code', version: null },
  scope: { projects: [], from: null, to: null, history_consented: false },
  win_definition: null,
  seed: null,
});

export const shrine = () => ({ commit: 'a'.repeat(40), manifest_sha: null, fetched_at: null });

export const ref = () => ({
  entry_id: 'deliberate-currency.sov.stale',
  page_id: 'principles/deliberate-currency',
  anchor: 'signal-of-violation',
  title: 'Deliberate Currency',
  section: 'principle',
  status: 'ratified',
  url_pinned: 'https://github.com/stablekernel/SHRINE/blob/a/docs/x.md#L1',
  quote: 'Drift',
});

export const finding = () => ({
  id: 'f1',
  lens: 'config',
  tab: 'amplify',
  title: 'Instruction files are stale',
  short: '2 files over 180 days',
  lead: 'One. Two.',
  icon: 'clock',
  provenance: 'mechanical',
  attribution: 'harness',
  confidence: { value: 0.9, label: 'high', basis: 'deterministic fact' },
  severity: { tokens_attributable: null, human_turns_attributable: null, delay_minutes: null, label: 'medium' },
  recurrence: { hits: null, sample: null, stratum: null, control_rate: null },
  evidence: [{ kind: 'mechanical', locator: '~/.claude/CLAUDE.md', metric: '200 days' }],
  anchor: 'e1',
  counter_reading: null,
  adversarial: null,
  episode_ref: null,
  why: ['a', 'b'],
  problem: ['a', 'b'],
  pivot: {
    kind: 'instruction',
    action: 'Do it.',
    before_scrubbed: null,
    after_scrubbed: null,
    after_marks: [],
    setup_note: '',
    source: 'shrine_generic',
    minutes_to_apply: 10,
  },
  praise_class: null,
  benefit: [],
  shrine_refs: [ref()],
  owner_label: 'Owner: Setup',
  timeline_gap: null,
  coverage_key: 'deliberate-currency',
});

export const findings = () => ({
  schema_version: 1,
  run: run(),
  shrine: shrine(),
  tier: 'T0',
  reviewers: 0,
  minutes_elapsed: 0,
  tokens_used: 0,
  headline: { counts: { amplify: 1 }, tldr: [], start_with: null },
  coverage: [],
  attribution_stack: null,
  findings: [finding()],
  worth_a_look: [],
  checked_clear: [],
  dropped: [],
  configured: [],
  control_slice: null,
  unknowable: [],
  skipped_files: [],
  integrity: { ok: true, changed_paths: [] },
});

export const facts = () => ({
  schema_version: 1,
  run: run(),
  shrine: shrine(),
  config: [
    {
      path_scrubbed: '~/.claude/CLAUDE.md',
      kind: 'instruction',
      layer: 'user',
      bytes: 10,
      mtime: '2026-01-01T00:00:00.000Z',
      sha256: 'b'.repeat(64),
      loaded_by: 'always',
    },
  ],
  repos: [],
  sessions: [],
  episodes: [],
  metrics: {},
});
