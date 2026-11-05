// Rule-based copywriter (spec 2, MVP): one template per T0 setup kind, filled from
// metric slots; checked-and-clear lines; empty states. All output passes copy
// lint (scripts/lint-copy.mjs renders sampleCopy()).
import { THRESHOLDS } from '../probes/config.mjs';

const T = THRESHOLDS.config;
const pl = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const joinOr = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

const FINDINGS = {
  stale_instructions: ({ metric: m }) => ({
    icon: 'clock',
    title: `Instruction files unchanged for over ${m.threshold_days} days`,
    short: `${m.count} of ${m.total} files, oldest ${m.max_age_days} days`,
    lead: `Some instruction or memory files have not changed in over ${m.threshold_days} days. The agent still follows them, including any rule that no longer holds.`,
    why: [
      `${m.count} of ${m.total} instruction or memory ${pl(m.total, 'file')} last changed over ${m.threshold_days} days ago.`,
      `The oldest last changed ${m.max_age_days} days ago.`,
      `Dates come from the last git commit, or from the file time when git has no commit for the file.${m.skipped ? ` ${m.skipped} ${pl(m.skipped, 'file')} in repos whose git history was not read ${m.skipped === 1 ? 'is' : 'are'} left out.` : ''}`,
    ],
    problem: [
      'Stale guidance is trusted guidance, so an outdated rule looks intentional.',
      'A fix you make in chat is lost when the file still says the old thing.',
    ],
    benefit: [
      { headline: `${m.count} ${pl(m.count, 'file')} to review`, sub: 'One pass clears the backlog', metric: 'count' },
      { headline: 'Rules you can trust', sub: 'Each file carries a recent review', metric: 'max_age_days' },
    ],
  }),
  oversized_instructions: ({ metric: m, items = [] }) => {
    const top = Math.max(1, Math.round((items[0]?.bytes ?? m.bytes) / 1024));
    return {
      icon: 'layers',
      title: `Always-loaded instructions are ${m.kb} KB`,
      short: `${m.kb} KB every session, policy ${m.threshold_kb} KB`,
      lead: 'Every session loads these instructions before the first prompt. Rules that apply everywhere compete with rules that rarely apply.',
      why: [
        `Always-loaded files total ${m.kb} KB for the largest project, over the ${m.threshold_kb} KB line.`,
        `The largest single file is ${top} KB.`,
        `The ${m.threshold_kb} KB line is this tool's policy, not a SHRINE number.`,
      ],
      problem: [
        'Context spent on rarely used rules is context not spent on the task.',
        'Long files hide the rules that matter most.',
      ],
      benefit: [
        { headline: `${Math.max(1, m.kb - m.threshold_kb)} KB to move`, sub: 'To get under the policy line', metric: 'kb' },
        { headline: 'A smaller start', sub: 'Every session loads less', metric: 'bytes' },
      ],
    };
  },
  no_owner_or_review: ({ metric: m }) => ({
    icon: 'book',
    title: 'Instruction files have no owner or review date',
    short: `${m.count} of ${m.total} files missing a line`,
    lead: 'Some instruction files do not say who owns them or when they were last reviewed. Without an owner, nobody is asked to look again.',
    why: [
      `${m.count} of ${m.total} instruction ${pl(m.total, 'file')} lack an owner line, a review date line, or both.`,
      "The format is this tool's convention, for example Owner: and Reviewed: with a date.",
    ],
    problem: [
      'Nobody is prompted to review a file that has no owner.',
      'Without a review date, file age is the only signal, and age alone says little.',
    ],
    benefit: [
      { headline: 'Clear ownership', sub: 'Someone is asked to look again', metric: 'count' },
      { headline: `${m.count} ${pl(m.count, 'file')} to update`, sub: 'Each needs 2 short lines', metric: 'count' },
    ],
  }),
  blanket_permissions: ({ metric: m, items = [] }) => {
    const rules = [...new Set(items.map((i) => i.rule))].slice(0, 3);
    // Allow rules and settings (defaultMode, skipDangerousModePermissionPrompt) are
    // counted apart, so a setting is never called a rule.
    const settings = m.settings ?? items.filter((i) => /^(defaultMode|skipDangerousModePermissionPrompt):/.test(i.rule)).length;
    const allows = m.rules ?? m.count - settings;
    const parts = [...(allows ? [`${allows} ${pl(allows, 'rule')}`] : []), ...(settings ? [`${settings} ${pl(settings, 'setting')}`] : [])];
    return {
      icon: 'hand',
      title: 'Shell or file writes run without a pause',
      short: `${joinAnd(parts)} ${m.count === 1 ? 'approves' : 'approve'} without asking`,
      lead: 'Your settings approve shell commands or file writes without asking, or skip the approval prompt. Judgment moves from the risky step to reading diffs after the fact.',
      why: [
        `Found: ${joinAnd(rules)}.`,
        'Each one applies in every project that reads these settings.',
      ],
      problem: [
        'A human checkpoint exists in name only, so out-of-scope writes are found by chance.',
        'Approvals that never ask cannot be tuned to the risky steps.',
      ],
      benefit: [
        { headline: 'Judgment where it counts', sub: 'You decide at the risky step only', metric: 'count' },
        { headline: `${m.count} ${pl(m.count, 'entry', 'entries')} to scope`, sub: 'Each becomes a narrow allow or a prompt', metric: 'count' },
      ],
    };
  },
  stack_gap: ({ metric: m }) => ({
    icon: 'wrench',
    title: `Setup has no ${joinOr(m.missing)}`,
    short: `${m.hooks} hooks, ${m.skills} skills, ${m.memory} memory files`,
    lead: 'The harness can run checks, load task skills, and keep memory across sessions. Your setup does not use at least one of these from any source, plugins included.',
    why: [
      `Counted from user, project, and plugin sources: ${m.hooks} hooks, ${m.skills} skills, ${m.memory} memory files.`,
      "This tool's own skill is not counted.",
    ],
    problem: [
      'Checks you repeat by hand stay habits instead of gates.',
      'Each session starts from scratch on what the harness could carry.',
    ],
    benefit: [
      { headline: 'Checks that run themselves', sub: 'A hook replaces a typed command', metric: 'hooks' },
      { headline: `${m.missing.length} ${pl(m.missing.length, 'gap')} to close`, sub: `Missing: ${joinAnd(m.missing)}`, metric: 'missing' },
    ],
  }),
  short_retention: ({ metric: m }) => ({
    icon: 'repeat',
    title: `Session history is kept for ${m.days} days`,
    short: `Retention ${m.days} days, ${m.source === 'default' ? 'the default' : 'from settings'}`,
    lead: 'Session history older than the retention window is deleted. Comparing behavior across releases needs history that outlives one cycle.',
    why: [
      `History retention is ${m.days} days, ${m.source === 'default' ? 'the harness default' : 'set in your settings'}.`,
      'This finding is informational; it changes nothing about how sessions run.',
    ],
    problem: [
      'Behavior shifts cannot be compared once older sessions are gone.',
      `Later inspect runs see only the last ${m.days} days.`,
    ],
    benefit: [{ headline: 'A longer window', sub: 'Compare behavior across releases', metric: 'days' }],
  }),
  // Usage kind; renders only when thresholds ship it as "candidates" (E5 keeps it an appendix count).
  done_without_test: ({ metric: m, control: c }) => ({
    icon: 'loop',
    title: 'Done claims with no test run before them (candidates)',
    short: `${m.flagged} of ${m.claims} claims, no prior test`,
    lead: 'Some replies reported work as done with no test or check command earlier in the episode. These are pattern candidates, not judged claims.',
    why: [
      `${m.flagged} of ${m.claims} done ${pl(m.claims, 'claim')} had no test or check command before them, over the ${Math.round(m.threshold * 100)}% line.`,
      controlSentence(c),
      'Claims are matched by a versioned pattern list, so some matches are not real claims.',
    ],
    problem: [
      'A done claim with no run behind it leaves you as the only check.',
      'Rework found later costs more turns than a test run now.',
    ],
    benefit: [
      { headline: 'Evidence with every done', sub: 'The reply quotes the test run', metric: 'claims' },
      { headline: `${m.flagged} ${pl(m.flagged, 'episode')} to check`, sub: 'Each one is listed in the evidence', metric: 'flagged' },
    ],
  }),
};

const pctOf = (r) => `${Math.round(r * 100)}%`;
function controlSentence(c) {
  if (!c || c.rest.n < THRESHOLDS.usage.control_min_episodes) return `No control baseline: fewer than ${THRESHOLDS.usage.control_min_episodes} other episodes to compare.`;
  return `Rework within ${THRESHOLDS.history.link_hours} hours: ${c.flagged.hits} of ${c.flagged.n} flagged ${pl(c.flagged.n, 'episode')} (${pctOf(c.flagged.rate)}), ${c.rest.hits} of ${c.rest.n} other ${pl(c.rest.n, 'episode')} (${pctOf(c.rest.rate)}).`;
}

// Appendix lines for the usage counts block. Every regex-based count says it is a count only.
export function usageLines(u) {
  if (!u) return [];
  const c = u.counts;
  const lines = [
    `${c.sessions} ${pl(c.sessions, 'session')} reviewed, ${c.episodes} ${pl(c.episodes, 'episode')}`,
    `${c.human_turns} human ${pl(c.human_turns, 'turn')}, ${c.interrupts} ${pl(c.interrupts, 'interrupt')}, ${c.compactions} ${pl(c.compactions, 'compaction')}`,
    `Subagent share of attributable tokens: ${pctOf(c.subagent_share)}`,
    `Correction candidates: ${c.correction_candidates} human ${pl(c.correction_candidates, 'turn')}. Count only, not judged.`,
    `Identical tool-call retries: ${c.retries} of ${c.tool_calls} tool ${pl(c.tool_calls, 'call')} (${c.retries_per_100} per 100 tool calls). Count only: polling and re-reads look the same.`,
  ];
  const dwt = u.kinds?.find((k) => k.kind === 'done_without_test');
  if (dwt && dwt.ship === 'appendix') {
    lines.push(`Done claims with no test or check run before them: ${dwt.metric.flagged} of ${dwt.metric.claims} ${pl(dwt.metric.claims, 'claim')}. Count only: the claim pattern is not precise enough for a finding.`);
    if (dwt.metric.flagged > 0) lines.push(controlSentence(dwt.control));
  }
  if (u.automation?.total) {
    lines.push(`Automation sessions left out: ${u.automation.count} of ${u.automation.total} ${pl(u.automation.total, 'session')} (${pctOf(u.automation.share)})`);
  }
  if (u.limited) lines.push(`Limited history: ${c.sessions} ${pl(c.sessions, 'session')}, fewer than ${THRESHOLDS.history.limited_sessions} sessions, so these counts may not reflect usual work.`);
  if (u.excluded_own) lines.push('The session driving this run was left out.');
  return lines;
}

export const HISTORY_NOTES = {
  limited: `Limited history: fewer than ${THRESHOLDS.history.limited_sessions} sessions in the window, so usage counts may not reflect usual work.`,
  none: 'Session history was approved, but no sessions were found in the window.',
};

const CLEAR = {
  stale_instructions: [`Instruction and memory files changed within ${T.stale_days} days`, 'Rules that no longer hold but still steer the agent'],
  oversized_instructions: [`Always-loaded instructions under ${Math.round(T.oversized_bytes / 1024)} KB`, 'Context spent on rules that rarely apply'],
  no_owner_or_review: ['Every instruction file names an owner and a review date', 'Files nobody is asked to review'],
  blanket_permissions: ['No blanket shell or write permissions', 'Risky steps that run without a human decision'],
  stack_gap: ['Hooks, skills, and memory are all configured', 'Repeating by hand what the harness can carry'],
  short_retention: [`History retention is over ${T.short_retention_days} days`, 'Losing the sessions needed to compare behavior over time'],
  instruction_layers: ['No rule line repeats across instruction layers', 'Layers that restate each other and then drift apart'],
  repo_layout: ['Repos in scope share one instruction layout', 'Each repo teaching the agent a different convention'],
  permissions_scoped: ['Permissions are scoped, with no bypass default', 'Risky steps that run without a human decision'],
  instructions_reviewed: [`Every instruction file was reviewed within ${T.review_days} days`, 'Guidance that outlives the code it describes'],
};

const UNKNOWABLE = [
  'Prompt quality and who owned each correction (needs Tier 1 or deeper)',
  'Whether instructions were followed in a session (needs session history and judgment)',
  'Contradictions between instruction files (needs judgment)',
  'Whether a change was correct when no later commit or test touched it',
];

export function emptyStates({ checks, notPassed = 0, tier = 'T0', historyRead = false }) {
  return {
    // checks counts passed checks only (no findings here), so the total adds the failed ones.
    tldr: notPassed ? `No findings against ${checks + notPassed} SHRINE checks; ${notPassed} did not pass.` : `No setup issues found against ${checks} SHRINE checks.`,
    // Checks that ran and failed with no finding kind at this tier yet.
    not_passed: notPassed
      ? `${notPassed} ${notPassed === 1 ? 'check' : 'checks'} ran and did not pass; no Tier ${String(tier).slice(1)} finding exists for ${notPassed === 1 ? 'it' : 'them'} yet.`
      : '',
    // Session history is only worth asking for when this run did not read it.
    tldr_next: historyRead
      ? notPassed
        ? 'Fix the checks that did not pass, then run again to confirm.'
        : 'Keep the checks below passing. Session history showed nothing to act on.'
      : notPassed
        ? 'Run again with session history for usage counts.'
        : 'Keep the checks below passing, or run again with session history for usage counts.',
    tab: {
      amplify: { title: 'Nothing cleared the bar yet.', body: 'More session history or a deeper tier adds usage findings.' },
      working: { title: 'Nothing cleared the bar yet.', body: 'Praise needs measured evidence from Tier 2 or deeper. Presence alone earns nothing.' },
    },
    attribution: 'Needs Tier 1 or deeper',
    attribution_body: 'Who owned each correction needs judged episodes. Only the prompt share is prompting advice.',
    before_after: 'Example from SHRINE',
  };
}

export const copy = {
  finding: (kind, probe) => {
    const fill = FINDINGS[kind];
    if (!fill) throw new Error(`no copy template for ${kind}`);
    return fill(probe);
  },
  clear: (name) => {
    const [check, guards_against] = CLEAR[name] ?? [];
    if (!check) throw new Error(`no clear line for ${name}`);
    return { check, guards_against };
  },
  unknowable: () => [...UNKNOWABLE],
  usageLines: (u) => usageLines(u),
  notes: HISTORY_NOTES,
};

export const SAMPLE_PROBES = {
  stale_instructions: { metric: { count: 2, total: 5, max_age_days: 400, threshold_days: T.stale_days, skipped: 1 }, items: [] },
  oversized_instructions: { metric: { bytes: 53248, kb: 52, threshold_kb: 40 }, items: [{ path: '~/.claude/CLAUDE.md', bytes: 46000 }] },
  no_owner_or_review: { metric: { count: 3, total: 4 }, items: [] },
  blanket_permissions: { metric: { count: 2, rules: 1, settings: 1 }, items: [{ rule: 'Bash' }, { rule: 'defaultMode: bypassPermissions' }] },
  stack_gap: { metric: { hooks: 0, skills: 0, memory: 1, missing: ['hooks', 'skills'] }, items: [] },
  short_retention: { metric: { days: 30, source: 'default', threshold_days: 30 }, items: [] },
  done_without_test: {
    metric: { flagged: 6, claims: 12, rate: 0.5, threshold: 0.3 },
    control: { flagged: { hits: 3, n: 6, rate: 0.5 }, rest: { hits: 10, n: 80, rate: 0.125 }, diff_points: 37.5 },
    items: [],
  },
};

export const SAMPLE_USAGE = {
  counts: { sessions: 66, episodes: 136, human_turns: 1171, interrupts: 22, compactions: 3, tool_calls: 5200, retries: 61, retries_per_100: 1.2, subagent_share: 0.452, correction_candidates: 40, done_claims: 12, done_without_test: 4 },
  kinds: [{ kind: 'done_without_test', ship: 'appendix', metric: { flagged: 4, claims: 12, rate: 0.33, threshold: 0.3 }, control: SAMPLE_PROBES.done_without_test.control }],
  automation: { count: 1069, total: 1135, share: 0.942 },
  limited: true,
  excluded_own: true,
};

// Everything the templates can emit, for scripts/lint-copy.mjs.
export function sampleCopy() {
  return {
    findings: Object.keys(FINDINGS).map((k) => copy.finding(k, SAMPLE_PROBES[k])),
    clear: Object.keys(CLEAR).map((k) => copy.clear(k)),
    unknowable: copy.unknowable(),
    empty: [0, 1, 2].flatMap((notPassed) => [false, true].map((historyRead) => emptyStates({ checks: 10, notPassed, historyRead }))),
    usage: usageLines(SAMPLE_USAGE),
    usage_no_control: usageLines({ ...SAMPLE_USAGE, kinds: [{ ...SAMPLE_USAGE.kinds[0], control: { flagged: { hits: 1, n: 4, rate: 0.25 }, rest: { hits: 0, n: 3, rate: 0 }, diff_points: 25 } }] }),
    notes: HISTORY_NOTES,
  };
}

// Lowercase words the report's own copy uses, for share-safe masking: a project
// named like one of them is masked only where it stands alone.
const LABELS = ['hooks', 'skills', 'agents', 'commands', 'servers', 'memory', 'files', 'instruction', 'plugins', 'sessions', 'episodes', 'setup', 'history'];
export function copyVocabulary() {
  const words = JSON.stringify(sampleCopy()).toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  return [...new Set([...words, ...LABELS])];
}
