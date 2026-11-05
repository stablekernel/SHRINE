// Generates test/fixtures/findings/mock-density.json: a spec-legal findings.json
// with the approved mock's layout density (4 amplify, 3 working, 7 tripped coverage areas,
// 3 TLDR lines, 4-event timelines, 3 why, 3 problem, 3 benefits). Only data the
// spec can produce: no CI events, no outcome numbers, structure praise capped at medium.
// Usage: node test/synth/mock-density.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { coverageAreas } from '../../src/scorer/score.mjs';

const cat = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/catalogue/catalogue.json', import.meta.url)), 'utf8'));
const pageRef = (pageId, section = 'principle') => {
  const all = [...cat.principles, ...cat.patterns, ...cat.stack];
  const p = all.find((x) => x.id === pageId);
  const e = (p.signals_of_violation ?? p.anti_patterns)[0];
  return {
    entry_id: e.entry_id,
    page_id: p.id,
    anchor: e.anchor,
    title: p.title,
    section,
    status: p.status,
    url: `${p.url}#${e.anchor}`,
    url_pinned: `https://github.com/stablekernel/SHRINE/blob/${cat.shrine.commit}/docs/src/content/docs/${p.id}.md#L${e.line}`,
    quote: e.text,
  };
};
const mapped = (id) => {
  const { url, ...rest } = cat.entries[id];
  return { ...rest, url };
};

const base = (o) => ({
  provenance: 'mechanical',
  counter_reading: null,
  adversarial: null,
  episode_ref: null,
  praise_class: null,
  timeline_gap: null,
  recurrence: { hits: null, sample: null, stratum: null, control_rate: null },
  ...o,
});

const conf = (value, basis) => ({ value, label: value >= 0.75 ? 'high' : value >= 0.5 ? 'medium' : 'low', basis });

const amplify = [
  base({
    id: 'mock-unverified-done',
    lens: 'usage',
    tab: 'amplify',
    kind: 'unverified_done',
    title: 'Work is declared done before it is checked',
    short: '17 corrections, 9 of 12 episodes',
    lead: 'Agents report success without running anything that could disprove it. Failures surface later, after other work builds on the change.',
    icon: 'loop',
    provenance: 'judged',
    attribution: 'harness',
    confidence: conf(0.8, 'one judge pass agrees with a mechanical anchor'),
    severity: { tokens_attributable: 61000, human_turns_attributable: 4, delay_minutes: 211, label: 'high' },
    recurrence: { hits: 9, sample: 12, stratum: 'all', control_rate: 0.2 },
    evidence: [
      { kind: 'mechanical', locator: 'commit a41f9c', metric: 'reverted 206 minutes after the done claim', excerpt_scrubbed: null },
      { kind: 'judge', locator: 'session s-114 turn 9', metric: null, verdict: 'claim not supported', judge_confidence: 0.8, excerpt_scrubbed: 'Done, the retry is in place.' },
    ],
    anchor: 'commit a41f9c',
    episode_ref: {
      episode_id: 'e-114-2',
      timeline: [
        { t: '10:02', label_scrubbed: 'Prompt: add retry to sync job', kind: 'neutral', event_kind: 'Prompt' },
        { t: '10:09', label_scrubbed: 'Agent reports done', kind: 'warn', event_kind: 'Done claim' },
        { t: '13:35', label_scrubbed: 'Revert commit a41f9c', kind: 'warn', event_kind: 'Commit' },
        { t: '14:05', label_scrubbed: 'Fix committed with tests', kind: 'resolve', event_kind: 'Commit' },
      ],
    },
    timeline_gap: { from_t: '10:09', to_t: '13:35', label: '206 minutes unverified' },
    why: [
      'In 9 of 12 sampled episodes, the first test run came after the agent said done.',
      'The same shape repeated across 3 repos, so it is a pattern, not an accident.',
      'Mechanical anchor: commit a41f9c was reverted 206 minutes after its done claim.',
    ],
    problem: [
      'Cost lands late and compounds: other work builds on the change before it is undone.',
      'You become the verification step, spending attention on checks a machine can run.',
      'Each late failure averaged 2 extra correction turns and 38K tokens.',
    ],
    pivot: {
      kind: 'hook',
      action: 'Add a stop hook that runs the test target and blocks the done message on failure.',
      before_scrubbed: 'Add retry to the sync job.',
      after_scrubbed: 'Add retry to the sync job.\nDone means: tests pass, and replaying the failed batch writes each record once.',
      after_marks: [[27, 107]],
      setup_note: 'Instructions can be skipped; a hook cannot. Run the same test target the CI job runs.',
      source: 'user_prompt',
      minutes_to_apply: 30,
    },
    benefit: [
      { headline: 'Minutes, not hours', sub: 'Failures surface while context is fresh' },
      { headline: '2 turns saved', sub: 'Per task that would have failed late' },
      { headline: 'Less attention spent', sub: 'You review results, not re-run checks' },
    ],
    shrine_refs: [pageRef('principles/fail-fast-recover-smart'), pageRef('patterns/verification-loops', 'pattern'), pageRef('stack/harness', 'stack')],
    owner_label: 'Owner: Setup',
    coverage_key: 'fail-fast-recover-smart',
  }),
  base({
    id: 'mock-late-constraint',
    lens: 'usage',
    tab: 'amplify',
    kind: 'late_constraint',
    title: 'Constraints arrive after the first build',
    short: '11 corrections, prompt side',
    lead: 'Prompts describe the goal but leave out the limits that decide the solution. The agent builds something reasonable, then you steer by correction.',
    icon: 'compass',
    provenance: 'judged',
    attribution: 'user',
    confidence: conf(0.7, 'one judge pass agrees with a mechanical anchor'),
    severity: { tokens_attributable: 22000, human_turns_attributable: 3, delay_minutes: 35, label: 'medium' },
    recurrence: { hits: 7, sample: 11, stratum: 'all', control_rate: null },
    evidence: [{ kind: 'mechanical', locator: 'session s-087 turn 3', metric: 'correction candidate in turn 3', excerpt_scrubbed: 'No new infrastructure.' }],
    anchor: 'session s-087 turn 3',
    episode_ref: {
      episode_id: 'e-087-1',
      timeline: [
        { t: '09:15', label_scrubbed: 'Prompt: speed up orders endpoint', kind: 'neutral', event_kind: 'Prompt' },
        { t: '09:40', label_scrubbed: 'Agent adds a cache', kind: 'warn', event_kind: 'Prompt' },
        { t: '09:52', label_scrubbed: 'Correction: no new infrastructure', kind: 'warn', event_kind: 'Correction' },
        { t: '10:30', label_scrubbed: 'Rebuilt with an index', kind: 'resolve', event_kind: 'Commit' },
      ],
    },
    timeline_gap: { from_t: '09:15', to_t: '09:52', label: '37 minutes before the constraint' },
    why: [
      'In 7 of 11 prompt-side corrections, the late constraint was knowable before the first prompt.',
      'Typical late constraints: no new infrastructure, keep the public API.',
      'Mechanical anchor: 4 sessions open with a correction within the first 3 turns.',
    ],
    problem: [
      'The agent solves the problem you described, not the one you have.',
      'Steering by correction costs tokens and anchors the agent on the first idea.',
      'The miss is quiet: the first build looks fine until the constraint is named.',
    ],
    pivot: {
      kind: 'habit',
      action: 'Name the win and the limits in the first prompt.',
      before_scrubbed: 'Speed up the orders endpoint.',
      after_scrubbed: 'Speed up the orders endpoint. No new infrastructure.',
      after_marks: [[30, 52]],
      setup_note: '',
      source: 'user_prompt',
      minutes_to_apply: 5,
    },
    benefit: [
      { headline: '1 turn saved', sub: 'Per task where constraints were knowable' },
      { headline: 'Better first build', sub: 'The agent explores options before committing' },
      { headline: 'Fewer surprises', sub: 'Limits are written down, not remembered' },
    ],
    shrine_refs: [pageRef('principles/problem-before-prescription'), pageRef('patterns/spec-then-build', 'pattern')],
    owner_label: 'Owner: You',
    coverage_key: 'problem-before-prescription',
  }),
  base({
    id: 'mock-blanket',
    lens: 'config',
    tab: 'amplify',
    kind: 'blanket_permissions',
    title: 'Shell and file writes run without a pause',
    short: '2 blanket allow rules',
    lead: 'Your settings allow every shell command and every file write. Judgment moves from the risky step to reading diffs after the fact.',
    icon: 'hand',
    attribution: 'harness',
    confidence: conf(0.9, 'deterministic fact from settings'),
    severity: { tokens_attributable: null, human_turns_attributable: null, delay_minutes: null, label: 'high' },
    evidence: [{ kind: 'mechanical', locator: '~/.claude/settings.json', metric: 'allow: Bash, Write' }],
    anchor: '~/.claude/settings.json',
    why: ['User settings allow Bash and Write with no scope.', 'The default permission mode skips the prompt for edits.', 'These rules apply to every project in scope.'],
    problem: ['A human checkpoint exists in name only.', 'Out-of-scope writes are found by chance, not by a gate.', 'Approvals that never ask cannot be tuned.'],
    pivot: { kind: 'config', action: 'Replace blanket allow rules with scoped ones.', before_scrubbed: '"allow": ["Bash", "Write"]', after_scrubbed: '"allow": ["Bash(npm test:*)"]', after_marks: [], setup_note: 'Keep reads open; ask on writes.', source: 'shrine_generic', minutes_to_apply: 10 },
    benefit: [
      { headline: 'Judgment where it counts', sub: 'You decide at the risky step only' },
      { headline: 'Fast approvals', sub: 'One line to read, not a diff to audit' },
      { headline: 'Safer by default', sub: 'Out-of-scope writes are stopped' },
    ],
    shrine_refs: [mapped('human-in-the-loop.sov.undefined-boundary')],
    owner_label: 'Owner: Setup',
    coverage_key: 'human-in-the-loop',
    config_strip: { mtime: '2026-09-02', last_git_change: null, sessions_since: 38 },
  }),
  base({
    id: 'mock-oversized',
    lens: 'config',
    tab: 'amplify',
    kind: 'oversized_instructions',
    title: 'Always-loaded instructions are large',
    short: '52 KB loaded every session',
    lead: 'Every session starts by loading 52 KB of instructions. Rules that matter compete with rules that rarely apply.',
    icon: 'layers',
    attribution: 'harness',
    confidence: conf(0.9, 'deterministic fact from file sizes'),
    severity: { tokens_attributable: null, human_turns_attributable: null, delay_minutes: null, label: 'medium' },
    evidence: [{ kind: 'mechanical', locator: '~/.claude/CLAUDE.md', metric: '52 KB always loaded' }],
    anchor: '~/.claude/CLAUDE.md',
    why: ['Always-loaded files total 52 KB, over the 40 KB tool policy.', 'The largest file holds 3 runbooks used in 1 of 10 sessions.', 'Imports pull in 2 more files on every start.'],
    problem: ['Context spent on rarely used rules is context not spent on the task.', 'Long files hide the rules that matter most.', 'Growth has no stopping point without a size check.'],
    pivot: { kind: 'instruction', action: 'Move rarely used sections into skills loaded on demand.', before_scrubbed: 'CLAUDE.md holds the whole runbook.', after_scrubbed: 'CLAUDE.md links to a runbook skill.', after_marks: [], setup_note: '', source: 'shrine_generic', minutes_to_apply: 10 },
    benefit: [
      { headline: 'Smaller start', sub: 'Every session loads less' },
      { headline: 'Clearer rules', sub: 'What applies everywhere stays visible' },
      { headline: '10 minutes', sub: 'One-time cost to move sections' },
    ],
    shrine_refs: [mapped('memory.ap.instruction-file-grows')],
    owner_label: 'Owner: Setup',
    coverage_key: 'stack/memory',
    config_strip: { mtime: '2026-10-30', last_git_change: '2026-10-30', sessions_since: 12 },
  }),
];

const working = [
  ['mock-layers', 'Instructions layer cleanly', '3 layers, 0 repeated rules', 'layers', 'authority-cascade.sov.reopened', 'authority-cascade'],
  ['mock-layout', 'Repos share one layout', '4 repos, one template', 'grid', 'consistency-as-leverage.sov.idioms', 'consistency-as-leverage'],
  ['mock-reviewed', 'Instruction files have a recent review', '5 files reviewed within 90 days', 'clock', 'deliberate-currency.sov.stale', 'deliberate-currency'],
].map(([id, title, short, icon, entry, key]) =>
  base({
    id,
    lens: 'config',
    tab: 'working',
    kind: 'structure',
    title,
    short,
    lead: 'Every item in scope passes this conformance check. The paired critique stayed under its threshold across 40 episodes.',
    icon,
    attribution: 'harness',
    praise_class: 'structure',
    confidence: conf(0.7, 'structure check, capped at medium'),
    severity: { tokens_attributable: null, human_turns_attributable: null, delay_minutes: null, label: 'low' },
    evidence: [{ kind: 'mechanical', locator: 'setup', metric: 'every item passes' }],
    anchor: 'setup',
    why: ['Every item in scope passes the check.', 'At least 3 items were in scope.', 'The paired critique was measured over 40 episodes.'],
    problem: ['Keep it this way: drift starts with one exception.', 'A new repo or file can break the pattern unnoticed.'],
    pivot: { kind: 'config', action: 'Keep the current structure.', before_scrubbed: null, after_scrubbed: null, after_marks: [], setup_note: '', source: 'shrine_generic', minutes_to_apply: 5 },
    benefit: [
      { headline: 'Predictable behavior', sub: 'The same rules apply every time' },
      { headline: 'Cheap onboarding', sub: 'New repos inherit the stack' },
      { headline: 'Fewer overrides', sub: 'Less correction per session' },
    ],
    shrine_refs: [mapped(entry)],
    owner_label: 'Owner: Setup',
    coverage_key: key,
  }),
);

const all = [...amplify, ...working];
const coverage = coverageAreas(cat).map((c) => ({
  ...c,
  checked: true,
  working: all.filter((f) => f.tab === 'working' && f.coverage_key === c.key).length,
  amplify: all.filter((f) => f.tab === 'amplify' && f.coverage_key === c.key).length,
}));

const out = {
  schema_version: 1,
  run: {
    id: 'mock-density',
    started_at: '2026-11-04T09:00:00.000Z',
    tool_version: '0.1.0',
    harness: { name: 'Claude Code', version: '2.1.318' },
    scope: { projects: ['project-1', 'project-2', 'project-3', 'project-4'], from: '2026-10-05', to: '2026-11-04', history_consented: true },
    win_definition: null,
    seed: 4242,
  },
  shrine: { commit: cat.shrine.commit, manifest_sha: null, fetched_at: null },
  tier: 'T2',
  reviewers: 5,
  minutes_elapsed: 22,
  tokens_used: 312000,
  headline: {
    counts: { amplify: 4, working: 3, worth_a_look: 1, checked_clear: 2, sessions: 38, corrections: 41 },
    tldr: [
      { status: 'amplify', headline: 'Work is declared done before it is checked.', sentence: 'This gap accounts for 17 of 41 corrections.', finding_id: 'mock-unverified-done' },
      { status: 'amplify', headline: 'Constraints arrive after the first build.', sentence: 'Naming them up front removes 1 correction turn per task.', finding_id: 'mock-late-constraint' },
      { status: 'working', headline: 'Instructions layer cleanly.', sentence: 'Every layer passes the cascade check across 3 layers.', finding_id: 'mock-layers' },
    ],
    start_with: { finding_id: 'mock-unverified-done', action: amplify[0].pivot.action, minutes_to_apply: 30, framed: true },
  },
  coverage,
  attribution_stack: { setup: 17, prompt: 11, model: 8, unknown: 5 },
  findings: all,
  worth_a_look: [
    base({
      ...amplify[3],
      id: 'mock-worth',
      tab: 'worth_a_look',
      title: 'Compactions cluster in long sessions',
      short: '3 compactions in 2 sessions',
      confidence: conf(0.45, 'below the evidence bar'),
      coverage_key: 'stack/memory',
    }),
  ],
  checked_clear: [
    { id: 'mock-cc-retention', check: 'History retention covers 90 days', entry_id: 'reproducibility.sov.not-logged', guards_against: 'Losing the sessions you need to compare behavior over time', title: 'Reproducibility', shrine_ref: mapped('reproducibility.sov.not-logged') },
    { id: 'mock-cc-stack', check: 'Hooks, skills, and memory are all configured', entry_id: 'harness.ap.under-investing', guards_against: 'Repeating by hand what the harness can run for you', title: 'Harness', shrine_ref: mapped('harness.ap.under-investing') },
  ],
  dropped: [{ id: 'mock-dropped', reason: 'no entry_id' }],
  configured: [
    { item: 'hooks', count: 4, detail: 'from user settings and 1 plugin' },
    { item: 'skills', count: 12 },
  ],
  control_slice: { episodes: 15, done_without_test_rate: 0.2 },
  unknowable: ['Whether a change was correct when no later commit or test touched it'],
  skipped_files: [{ path_scrubbed: '~/.claude/projects/<project-2>/a.jsonl', reason: 'corrupt line 1' }],
  integrity: { ok: true, changed_paths: [] },
  diff: { new: 1, cleared: 1, unchanged: 5 },
  notes: [],
  history: { consented: true, read: true, sessions: 38 },
};

writeFileSync(fileURLToPath(new URL('../fixtures/findings/mock-density.json', import.meta.url)), `${JSON.stringify(out, null, 2)}\n`);
console.log('wrote mock-density.json');
