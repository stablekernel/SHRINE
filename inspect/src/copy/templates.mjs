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
  // Judged kinds (T1). Every one is a candidate: the title says so, and the
  // report adds the plain caveat.
  late_constraint: ({ metric: m }) => ({
    icon: 'compass',
    title: 'Constraints arrived after the work started (candidate)',
    short: `${m.hits} of ${m.judged} judged episodes`,
    lead: 'In some judged episodes, a rule or limit the agent needed arrived in your second or third message, after it had started. A model judged these, so treat them as leads.',
    why: [
      `${m.hits} of ${m.judged} judged ${pl(m.judged, 'episode')} had a correction in your second or third message that supplied a constraint.`,
      'That constraint was in neither your first message nor the instruction files loaded for that session.',
      'Code flags the correction candidates; a model judged whether each one supplied a constraint.',
    ],
    problem: [
      'Each late constraint costs a round trip, and the agent redoes work it already did.',
      'A constraint that lives only in chat comes back in later sessions.',
    ],
    benefit: [
      { headline: `${m.human_turns} ${pl(m.human_turns, 'message')} after these corrections`, sub: 'Fewer when the constraint comes first', metric: 'human_turns' },
      { headline: `${m.corrections} ${pl(m.corrections, 'correction')} to review`, sub: 'Each is listed in the evidence', metric: 'corrections' },
    ],
  }),
  ignored_instruction: ({ metric: m }) => ({
    icon: 'layers',
    title: 'Loaded rules were restated in chat (candidate)',
    short: `${m.hits} of ${m.judged} judged episodes`,
    lead: 'In some judged episodes, you corrected the agent with a rule your loaded instruction files already held. A model judged these, so treat them as leads.',
    why: [
      `${m.hits} of ${m.judged} judged ${pl(m.judged, 'episode')} had a correction that repeated a rule from a loaded instruction file.`,
      'The rule was matched by an exact quote from the instruction text loaded for that session.',
      'Code flags the correction candidates; a model judged whether each one repeated a loaded rule.',
    ],
    problem: [
      'A rule the agent does not follow is a rule you enforce by hand.',
      'Restating it in chat fixes one session, not the next.',
    ],
    benefit: [
      { headline: `${m.corrections} ${pl(m.corrections, 'correction')} a check could catch`, sub: 'A hook or gate runs the rule for you', metric: 'corrections' },
      { headline: `${m.human_turns} ${pl(m.human_turns, 'message')} after these corrections`, sub: 'Fewer when the rule is enforced', metric: 'human_turns' },
    ],
  }),
};

// Dashed timeline gap label for a judged finding.
export function gapLabel(kind, minutes) {
  const span = `${minutes} ${pl(minutes, 'minute')}`;
  return kind === 'late_constraint' ? `Constraint arrived ${span} in` : `Rule restated ${span} in`;
}

const pctOf = (r) => `${Math.round(r * 100)}%`;
function controlSentence(c) {
  if (!c || c.rest.n < THRESHOLDS.usage.control_min_episodes) return `No control baseline: fewer than ${THRESHOLDS.usage.control_min_episodes} other episodes with linked commits to compare.`;
  if (!c.flagged.n) return 'No control comparison: no flagged episode has a linked commit.';
  const small = c.flagged.n < THRESHOLDS.usage.small_n_episodes ? `, a small sample under ${THRESHOLDS.usage.small_n_episodes} episodes` : '';
  return `Rework (named reverts) within ${THRESHOLDS.history.link_hours} hours: ${c.flagged.hits} of ${c.flagged.n} flagged ${pl(c.flagged.n, 'episode')} with linked commits (${pctOf(c.flagged.rate)}${small}), ${c.rest.hits} of ${c.rest.n} other ${pl(c.rest.n, 'episode')} with linked commits (${pctOf(c.rest.rate)}).`;
}

// True when one project holds more than the threshold share of episodes.
export const dominated = (c) => c?.top_project_share != null && c.top_project_share > THRESHOLDS.usage.dominant_project_share;

// The usage-section line for a sample one project dominates, or null.
export function dominanceLine(c) {
  if (!dominated(c)) return null;
  if (c.projects === 1) return `One project: all ${c.episodes} ${pl(c.episodes, 'episode')} come from 1 project, so every rate here describes that project only.`;
  return `One project dominates: ${c.top_project_episodes} of ${c.episodes} ${pl(c.episodes, 'episode')} (${pctOf(c.top_project_share)}) come from 1 of ${c.projects} projects, so every rate here mostly describes that project.`;
}

// What the scan dropped before counting, or null when nothing was dropped.
export function dedupeLine(c) {
  const r = c?.resent_messages ?? 0;
  const f = c?.forked_sessions ?? 0;
  if (!r && !f) return null;
  const parts = [];
  if (r) parts.push(`${r} resent ${pl(r, 'message')} (the same text sent again after an interrupt or an unanswered send)`);
  if (f) {
    const k = c.forked_sessions_dropped ?? 0;
    const left = k ? `; ${k} of ${f} ${pl(f, 'file')} had nothing new and ${k === 1 ? 'was' : 'were'} left out` : '';
    parts.push(`${c.copied_messages ?? 0} copied ${pl(c.copied_messages ?? 0, 'message')} in ${f} session ${pl(f, 'file')} that repeat lines already read (a fork, a resume, or one session saved in 2 folders${left})`);
  }
  return `Dropped before counting: ${parts.join(', and ')}.`;
}

// The "do you need it yet" line shown at Gate B, before a depth is chosen. need:
// {consented, rule, sessions, human_messages, span_days}; rule is historyRule().
export function needLine(need, { t1 = false } = {}) {
  const q = 'Do you need more than a scan yet?';
  if (!need?.consented) return `${q} Unknown: session history was not read.`;
  if (need.rule === 'setup_only') return `${q} Unknown: no session in the window could be used.`;
  const what = `${need.sessions} ${pl(need.sessions, 'session')} and ${need.human_messages} of your ${pl(need.human_messages, 'message')} over ${need.span_days} ${pl(need.span_days, 'day')}`;
  const h = THRESHOLDS.history;
  if (need.rule === 'limited') return `${q} Not yet: ${what} is limited history, under ${h.limited_sessions} sessions, so a scan is all it supports.`;
  // Enough sessions, but few messages or a short span: still thin (provisional bars).
  if (need.human_messages < h.need_min_messages || need.span_days < h.need_min_days) return `${q} Not yet: ${what} is a short history, under ${h.need_min_messages} messages or ${h.need_min_days} days, so a scan is all it supports.`;
  return `${q} Maybe: ${what} is enough history for a deeper look; ${t1 ? 'T1 below judges a sample' : 'this version offers the scan only'}.`;
}

// Appendix lines for the usage counts block. Every regex-based count says it is a count only.
export function usageLines(u) {
  if (!u) return [];
  const c = u.counts;
  // Every rate below gets a short note when one project dominates the sample.
  const dep = dominated(c) ? ` Mostly 1 project: ${pctOf(c.top_project_share)} of episodes.` : '';
  const lines = [
    `${c.sessions} ${pl(c.sessions, 'session')} reviewed, ${c.episodes} ${pl(c.episodes, 'episode')}`,
    ...[dominanceLine(c)].filter(Boolean),
    `${c.human_turns} human ${pl(c.human_turns, 'message')}, ${c.interrupts} ${pl(c.interrupts, 'interrupt')}, ${c.compactions} ${pl(c.compactions, 'compaction')}`,
    c.attributable_tokens ? `Subagent share of attributable tokens: ${pctOf(c.subagent_share)} of ${c.attributable_tokens.toLocaleString('en-US')} tokens.${dep}` : 'Subagent share of attributable tokens: n/a, no attributable tokens.',
    `Correction candidates: ${c.correction_candidates} human ${pl(c.correction_candidates, 'message')}, each counted once however many cues it holds. Count only, not judged.`,
    c.tool_calls
      ? `Identical tool-call retries: ${c.retries} of ${c.tool_calls} tool ${pl(c.tool_calls, 'call')} (${c.retries_per_100} per 100 tool calls). Count only: polling and re-reads look the same.${dep}`
      : 'Identical tool-call retries: n/a, no tool calls.',
  ];
  const dwt = u.kinds?.find((k) => k.kind === 'done_without_test');
  if (dwt && dwt.ship === 'appendix') {
    lines.push(dwt.metric.claims
      ? `Done claims with no test or check run before them: ${dwt.metric.flagged} of ${dwt.metric.claims} ${pl(dwt.metric.claims, 'claim')}. Count only: the claim pattern is not precise enough for a finding.${dep}`
      : 'Done claims with no test or check run before them: n/a, no done claims.');
    if (dwt.metric.flagged > 0) lines.push(`${controlSentence(dwt.control)}${dwt.control?.flagged?.n && dwt.control.rest.n >= THRESHOLDS.usage.control_min_episodes ? dep : ''}`);
  }
  if (c.possible_rework != null) {
    const n = c.linked_commits ?? 0;
    const small = n < THRESHOLDS.usage.small_n_episodes ? `, a small sample under ${THRESHOLDS.usage.small_n_episodes} episodes` : '';
    lines.push(n
      ? `Rework (named reverts) within ${THRESHOLDS.history.link_hours} hours: ${c.rework} of ${n} ${pl(n, 'episode')} with linked commits (${pctOf(c.rework / n)}${small}).${dep}`
      : c.history_unread
        ? `Rework (named reverts) within ${THRESHOLDS.history.link_hours} hours: n/a, no episode in a repo with git history read has a linked commit.`
        : `Rework (named reverts) within ${THRESHOLDS.history.link_hours} hours: no episode has a linked commit, so there is nothing to count.`);
    if (n && c.possible_fix != null) lines.push(`Possible rework (later-session fix): ${c.possible_fix} of ${n} ${pl(n, 'episode')} with linked commits had a fix commit on the same files from a later session, at least 1 hour after. Candidate count only.${dep}`);
    if (c.committed_unlinked) lines.push(`Unlinked commits: ${c.committed_unlinked} ${pl(c.committed_unlinked, 'episode')} ran a commit command with no commit found in git, left out of rework counts.`);
    if (c.history_unread) lines.push(`History not read: ${c.history_unread} ${pl(c.history_unread, 'episode')} ran a commit command in a repo whose git history was not read, left out of rework and commit-link counts.`);
    lines.push(c.episodes
      ? `Possible rework (file overlap): ${c.possible_rework} of ${c.episodes} ${pl(c.episodes, 'episode')} had a changed file touched again within ${THRESHOLDS.history.link_hours} hours. Candidate count only.${dep}`
      : 'Possible rework (file overlap): n/a, no episodes.');
    if (c.iteration_commits != null) lines.push(`Iteration commits: ${c.iteration_commits} fix ${pl(c.iteration_commits, 'commit')} in the same session or within 1 hour. Normal iteration, not rework.`);
  }
  const a = u.automation;
  if (a?.total) {
    lines.push(`Housekeeping automation left out: ${a.housekeeping} of ${a.total} ${pl(a.total, 'session')} (${pctOf(a.share)})`);
    if (a.spawned_linked) lines.push(`Spawned automation: ${a.spawned_linked} ${pl(a.spawned_linked, 'session')} linked to ${a.spawned_parents} of your sessions as byproducts, not judged`);
    if (a.unattributed) lines.push(`Unattributed automation: ${a.unattributed} ${pl(a.unattributed, 'session')} with no parent session found, not read`);
  }
  const dropped = dedupeLine(c);
  if (dropped) lines.push(dropped);
  if (u.limited) lines.push(`Limited history: ${c.sessions} ${pl(c.sessions, 'session')}, fewer than ${THRESHOLDS.history.limited_sessions} sessions, so these counts may not reflect usual work.`);
  if (u.excluded_own) lines.push('The session driving this run was left out.');
  return lines;
}

const num = (n) => Number(n ?? 0).toLocaleString('en-US');
const J = THRESHOLDS.judged;
const MEASURED_ON = J.estimate.measured_on;

// Appendix lines for a T1 run's judging block. s: judgedFindings().summary plus
// the sample and the Gate B estimate (see mergeJudged).
export function judgingLines(s) {
  const o = s.outcomes ?? {};
  const x = s.sample ?? {};
  const calls = s.calls ?? s.planned;
  const lines = [
    `${s.judged} of ${s.planned} sampled ${pl(s.planned, 'episode')} judged in ${calls} model ${pl(calls, 'call')}, retries included${s.model_ids?.length ? ` (${s.model_ids.join(', ')})` : ''}.`,
    `Outcomes: ${o.resolved ?? 0} resolved, ${o.abandoned ?? 0} abandoned, ${o.reworked ?? 0} reworked, ${o.unknown ?? 0} could not tell.`,
    `Corrections traced: ${s.corrections_traced} on code-flagged ${pl(s.corrections_traced, 'turn')}; ${s.unknown_verdicts} could not be attributed and are counted only.`,
    `Answers rejected: ${s.invalid} invalid, ${s.refusals ?? 0} ${pl(s.refusals ?? 0, 'refusal')}.`,
    `Tokens used: ${s.tokens_floor ? 'at least ' : ''}${num(s.tokens_used)} tokens on your own account${s.estimate ? `, against an estimate of ${num(s.estimate.tokens_low)} to ${num(s.estimate.tokens_high)} tokens` : ''}.`,
    `A judged finding needs ${s.bar} ${pl(s.bar, 'episode')} and a code-flagged correction in each.`,
    'Judged findings stay candidates until the judge is measured against labelled episodes.',
  ];
  if (s.partial) lines.push(`Partial: ${s.judged} of ${s.planned} ${pl(s.planned, 'episode')} judged. Judging stopped early and you kept the partial results.`);
  if (s.estimate && s.tokens_used > s.estimate.tokens_high) lines.push(`Tokens passed the approved upper bound of ${num(s.estimate.tokens_high)} tokens on the last call.`);
  if (s.tokens_floor) lines.push('Some calls ended without a usage report (a timeout or a cut-off answer), so their input size was counted instead.');
  if (x.thin) lines.push(`Thin evidence: fewer than ${J.episodes} episodes had a correction candidate, so every one of them was judged.`);
  if (x.small_history) lines.push(`Fewer than ${J.thin_total_episodes} episodes in the window: no control comparison at this tier.`);
  if (x.cap_relaxed) lines.push(`One project held most episodes, so the cap of ${J.per_project} episodes per project was relaxed.`);
  return lines;
}

// Gate B lines for a T1 offer. g: {available, episodes, projects, from, to,
// tokens_low, tokens_high, minutes, eligible, thin, disclosure}.
export function gateBLines(g) {
  const lines = ['Tier T0 (pre-selected): scan only, no model calls.'];
  if (!g.available?.ok) {
    lines.push(`Tier T1 is not available here: ${g.available?.reason ?? 'unknown reason'}. Only T0 is offered.`);
    return lines;
  }
  const where = g.projects?.length ? ` from ${joinAnd(g.projects)}` : '';
  lines.push(`Tier T1, Pulse: judge ${g.episodes} ${pl(g.episodes, 'episode')}${where}, dated ${(g.from ?? '').slice(0, 10)} to ${(g.to ?? '').slice(0, 10)}, about ${num(g.tokens_low)} to ${num(g.tokens_high)} tokens on your own account, about ${g.minutes} ${pl(g.minutes, 'minute')}.`);
  if (g.version) lines.push(`Judge: Claude Code ${g.version}, the version in your newest session log.`);
  if (g.thin) lines.push(`Thin evidence: only ${g.eligible} ${pl(g.eligible, 'episode')} had a correction candidate.`);
  lines.push(`The token and time figures use a per-call overhead measured on Claude Code ${MEASURED_ON}, not on your setup.`);
  lines.push(`Judging stops early past ${num(g.tokens_high)} tokens, past ${Math.ceil(g.minutes * J.abort.time_box_factor)} minutes, or when over ${Math.round(J.abort.error_rate * 100)}% of answers are invalid; you then keep partial results or stop.`);
  for (const d of g.disclosure ?? []) lines.push(d);
  lines.push('Judged findings are candidates: a model read the episodes and its accuracy is not yet measured.');
  return lines;
}

const SAMPLE_JUDGING = { planned: 12, judged: 11, invalid: 0, refusals: 0, outcomes: { resolved: 7, abandoned: 2, reworked: 1, unknown: 1 }, corrections_traced: 14, unknown_verdicts: 3, bar: 3, tokens_used: 41200, model_ids: ['model-a'], estimate: { tokens_low: 38000, tokens_high: 54000, minutes: 5 } };
const SAMPLE_GATE_B = { available: { ok: true }, episodes: 12, projects: ['project-a', 'project-b'], from: '2026-10-06T00:00:00Z', to: '2026-11-04T00:00:00Z', tokens_low: 38000, tokens_high: 54000, minutes: 5, eligible: 9, thin: true, disclosure: ['Each judge call is one headless call on your own login.'] };

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
    attribution: tier === 'T0' ? 'Needs Tier 1 or deeper' : 'No correction traced',
    attribution_body: tier === 'T0' ? 'Who owned each correction needs judged episodes. Only the prompt share is prompting advice.' : 'The judged episodes held no code-flagged correction the judge confirmed.',
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
  needLine: (n, o) => needLine(n, o),
  dominanceLine: (c) => dominanceLine(c),
  gapLabel: (kind, minutes) => gapLabel(kind, minutes),
  judgingLines: (x) => judgingLines(x),
  gateBLines: (g) => gateBLines(g),
  notes: HISTORY_NOTES,
};

export const SAMPLE_PROBES = {
  stale_instructions: { metric: { count: 2, total: 5, max_age_days: 400, threshold_days: T.stale_days, skipped: 1 }, items: [] },
  oversized_instructions: { metric: { bytes: 53248, kb: 52, threshold_kb: 40 }, items: [{ path: '~/.claude/CLAUDE.md', bytes: 46000 }] },
  no_owner_or_review: { metric: { count: 3, total: 4 }, items: [] },
  blanket_permissions: { metric: { count: 2, rules: 1, settings: 1 }, items: [{ rule: 'Bash' }, { rule: 'defaultMode: bypassPermissions' }] },
  stack_gap: { metric: { hooks: 0, skills: 0, memory: 1, missing: ['hooks', 'skills'] }, items: [] },
  short_retention: { metric: { days: 30, source: 'default', threshold_days: 30 }, items: [] },
  late_constraint: { metric: { hits: 4, judged: 12, corrections: 5, tokens: 42000, human_turns: 9, sessions: 4, repos: 2 } },
  ignored_instruction: { metric: { hits: 1, judged: 1, corrections: 1, tokens: 900, human_turns: 1, sessions: 1, repos: 1 } },
  done_without_test: {
    metric: { flagged: 6, claims: 12, rate: 0.5, threshold: 0.3 },
    control: { flagged: { hits: 3, n: 6, rate: 0.5 }, rest: { hits: 10, n: 80, rate: 0.125 }, diff_points: 37.5 },
    items: [],
  },
};

export const SAMPLE_USAGE = {
  counts: { sessions: 66, episodes: 136, committed: 60, linked_commits: 60, committed_unlinked: 0, rework: 2, possible_fix: 7, iteration_commits: 85, possible_rework: 48, human_turns: 1171, interrupts: 22, compactions: 3, tool_calls: 5200, retries: 61, retries_per_100: 1.2, subagent_share: 0.452, attributable_tokens: 18400000, correction_candidates: 40, done_claims: 12, done_without_test: 4, resent_messages: 9, forked_sessions: 3, copied_messages: 41, forked_sessions_dropped: 1, projects: 4, top_project_episodes: 98, top_project_share: 0.721 },
  kinds: [{ kind: 'done_without_test', ship: 'appendix', metric: { flagged: 4, claims: 12, rate: 0.33, threshold: 0.3 }, control: SAMPLE_PROBES.done_without_test.control }],
  automation: { housekeeping: 987, spawned: 120, spawned_linked: 100, spawned_parents: 14, unattributed: 20, total: 1172, share: 0.842 },
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
    empty_t1: emptyStates({ checks: 10, tier: 'T1', historyRead: true }),
    usage: usageLines(SAMPLE_USAGE),
    usage_no_control: usageLines({ ...SAMPLE_USAGE, kinds: [{ ...SAMPLE_USAGE.kinds[0], control: { flagged: { hits: 1, n: 4, rate: 0.25 }, rest: { hits: 0, n: 3, rate: 0 }, diff_points: 25 } }] }),
    usage_one_project: usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, projects: 1, top_project_episodes: 136, top_project_share: 1, resent_messages: 1, forked_sessions: 1, copied_messages: 1, forked_sessions_dropped: 0 } }),
    need: [
      { consented: false },
      { consented: true, rule: 'setup_only', sessions: 0, human_messages: 0, span_days: 0 },
      { consented: true, rule: 'limited', sessions: 1, human_messages: 1, span_days: 1 },
      { consented: true, rule: 'probe', sessions: 12, human_messages: 15, span_days: 3 },
      { consented: true, rule: 'probe', sessions: 66, human_messages: 1171, span_days: 30 },
    ].map(needLine),
    notes: HISTORY_NOTES,
    gaps: [1, 12].flatMap((n) => ['late_constraint', 'ignored_instruction'].map((k) => gapLabel(k, n))),
    judging: [judgingLines(SAMPLE_JUDGING), judgingLines({ ...SAMPLE_JUDGING, partial: true, invalid: 1, refusals: 1, calls: 13, tokens_used: 60000, tokens_floor: true, sample: { thin: true, small_history: true, cap_relaxed: true } })],
    gate_b: [gateBLines(SAMPLE_GATE_B), gateBLines({ ...SAMPLE_GATE_B, available: { ok: false, reason: 'no claude command on PATH' } })],
    caveat: 'A model read these episodes. Its accuracy is not yet measured. Treat this as a lead, not a verdict.',
  };
}

// Lowercase words the report's own copy uses, for share-safe masking: a project
// named like one of them is masked only where it stands alone.
const LABELS = ['hooks', 'skills', 'agents', 'commands', 'servers', 'memory', 'files', 'instruction', 'plugins', 'sessions', 'episodes', 'setup', 'history'];
export function copyVocabulary() {
  const words = JSON.stringify(sampleCopy()).toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
  return [...new Set([...words, ...LABELS])];
}
