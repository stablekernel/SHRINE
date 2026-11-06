import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copy, sampleCopy, SAMPLE_PROBES, SAMPLE_USAGE, emptyStates, usageLines } from '../../src/copy/templates.mjs';
import { copyProblems, copyProblemsDeep } from '../../src/copy/rules.mjs';

const KINDS = ['stale_instructions', 'oversized_instructions', 'no_owner_or_review', 'blanket_permissions', 'stack_gap', 'short_retention'];
const sentences = (s) => s.split(/(?<=[.!?])\s+/).filter(Boolean).length;

for (const kind of KINDS) {
  test(`${kind}: template fills every field within limits`, () => {
    const c = copy.finding(kind, SAMPLE_PROBES[kind]);
    assert.ok(c.title.length < 70, `title ${c.title.length} chars`);
    assert.ok(c.short.length < 50, `short ${c.short.length} chars: ${c.short}`);
    assert.equal(sentences(c.lead), 2, c.lead);
    assert.ok(c.why.length >= 2 && c.why.length <= 3);
    assert.ok(c.problem.length >= 2 && c.problem.length <= 3);
    assert.ok(c.benefit.length >= 1 && c.benefit.length <= 3);
    for (const b of c.benefit) assert.ok(b.headline && b.sub && b.metric, 'each benefit names its metric slot');
    assert.ok(!/\$\{|undefined|NaN|null/.test(JSON.stringify(c)), 'all slots filled');
  });
}

test('templates use metric slots', () => {
  const a = copy.finding('stale_instructions', { ...SAMPLE_PROBES.stale_instructions, metric: { ...SAMPLE_PROBES.stale_instructions.metric, max_age_days: 401 } });
  assert.match(a.short, /401 days/);
  assert.match(a.why.join(' '), /1 file in repos whose git history was not read is left out\./);
  const none = copy.finding('stale_instructions', { ...SAMPLE_PROBES.stale_instructions, metric: { ...SAMPLE_PROBES.stale_instructions.metric, skipped: 0 } });
  assert.doesNotMatch(none.why.join(' '), /left out/);
  const b = copy.finding('oversized_instructions', { ...SAMPLE_PROBES.oversized_instructions, metric: { ...SAMPLE_PROBES.oversized_instructions.metric, kb: 77 } });
  assert.match(b.title, /77 KB/);
});

// A setting (defaultMode, skipDangerousModePermissionPrompt) is not a rule.
test('blanket_permissions counts allow rules and settings apart', () => {
  const short = (metric) => copy.finding('blanket_permissions', { metric, items: [] }).short;
  assert.equal(short({ count: 6, rules: 4, settings: 2 }), '4 rules and 2 settings approve without asking');
  assert.equal(short({ count: 1, rules: 1, settings: 0 }), '1 rule approves without asking');
  assert.equal(short({ count: 2, rules: 0, settings: 2 }), '2 settings approve without asking');
  assert.equal(short({ count: 3 }), '3 rules approve without asking');
  const old = copy.finding('blanket_permissions', { metric: { count: 2 }, items: [{ rule: 'Bash' }, { rule: 'skipDangerousModePermissionPrompt: true' }] });
  assert.equal(old.short, '1 rule and 1 setting approve without asking');
  const b = copy.finding('blanket_permissions', { metric: { count: 6, rules: 4, settings: 2 }, items: [] }).benefit;
  assert.ok(b.some((x) => x.headline === '6 entries to scope'));
  assert.ok(!copy.finding('blanket_permissions', SAMPLE_PROBES.blanket_permissions).short.includes('2 rules'));
});

test('every clear line and the unknowable list are filled', () => {
  for (const name of [...KINDS, 'instruction_layers', 'repo_layout', 'permissions_scoped', 'instructions_reviewed']) {
    const c = copy.clear(name);
    assert.ok(c.check && c.guards_against, name);
  }
  assert.ok(copy.unknowable().length >= 2);
});

test('empty states per spec 5', () => {
  const e = emptyStates({ checks: 10 });
  assert.equal(e.tldr, 'No setup issues found against 10 SHRINE checks.');
  assert.match(e.tab.amplify.title, /Nothing cleared the bar yet/);
  assert.match(e.tab.working.title, /Nothing cleared the bar yet/);
  assert.equal(e.attribution, 'Needs Tier 1 or deeper');
  assert.equal(e.not_passed, '');
  assert.equal(emptyStates({ checks: 9, notPassed: 1 }).not_passed, '1 check ran and did not pass; no Tier 0 finding exists for it yet.');
  assert.equal(emptyStates({ checks: 9, notPassed: 2, tier: 'T1' }).not_passed, '2 checks ran and did not pass; no Tier 1 finding exists for them yet.');
});

// "No setup issues" next to "M checks did not pass" contradicts itself.
test('empty state with checks that did not pass claims no clean bill', () => {
  const e = emptyStates({ checks: 9, notPassed: 1 });
  assert.equal(e.tldr, 'No findings against 10 SHRINE checks; 1 did not pass.');
  assert.doesNotMatch(e.tldr_next, /keep the checks/i);
  assert.match(emptyStates({ checks: 10 }).tldr_next, /Keep the checks below passing/);
});

test('all template output passes copy lint', () => {
  assert.deepEqual(copyProblemsDeep(sampleCopy()), []);
});

test('copy lint catches each rule', () => {
  assert.deepEqual(copyProblems('Fix it — now'), ['em dash']);
  assert.match(copyProblems('This is bad setup')[0], /judgment/);
  assert.deepEqual(copyProblems('It costs $40'), ['dollars', 'number without unit "40"']);
  assert.deepEqual(copyProblems('Size is 52.'), ['number without unit "52"']);
  assert.deepEqual(copyProblems('Size is 52 KB on 2026-11-04 in Tier 1.'), []);
});

// "Run again with session history" after history was read sends the reader in a circle.
test('the empty-state next step only asks for session history when it was not read', () => {
  for (const notPassed of [0, 1]) {
    const unread = emptyStates({ checks: 9, notPassed });
    const read = emptyStates({ checks: 9, notPassed, historyRead: true });
    assert.match(unread.tldr_next, /session history/);
    assert.doesNotMatch(read.tldr_next, /run again with session history/i);
    assert.notEqual(read.tldr_next, unread.tldr_next);
  }
});

test('rework lines use episodes with linked commits as N and show unlinked commit episodes apart', () => {
  const lines = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, episodes: 31, committed: 15, linked_commits: 3, committed_unlinked: 12, rework: 1, possible_fix: 0 } });
  const text = lines.join('\n');
  assert.match(text, /Rework \(named reverts\) within 72 hours: 1 of 3 episodes with linked commits \(33%/);
  assert.match(text, /Possible rework \(later-session fix\): 0 of 3 episodes with linked commits/);
  assert.match(text, /Unlinked commits: 12 episodes ran a commit command with no commit found in git, left out of rework counts\./);
  assert.doesNotMatch(text, /of 15 /);
  const control = lines.find((l) => /flagged episode/.test(l));
  assert.match(control, /episodes with linked commits/);
});

test('rework and subagent lines name N and give no percentage of zero', () => {
  const none = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, linked_commits: 0, rework: 0, possible_fix: 0, subagent_share: 0, attributable_tokens: 0 } }).join('\n');
  assert.doesNotMatch(none, /0 of 0|\(0%/);
  assert.match(none, /Rework \(named reverts\) within 72 hours: no episode has a linked commit, so there is nothing to count\./);
  assert.match(none, /Subagent share of attributable tokens: n\/a, no attributable tokens\./);
  const some = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, linked_commits: 3, rework: 1, subagent_share: 0.25, attributable_tokens: 12000 } }).join('\n');
  assert.match(some, /1 of 3 episodes with linked commits \(33%, a small sample under 15 episodes\)\./);
  assert.match(some, /Subagent share of attributable tokens: 25% of 12,000 tokens\./);
});

test('history-not-read episodes get their own line and no unlinked or nothing-to-count wording', () => {
  const lines = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, linked_commits: 0, committed_unlinked: 12, history_unread: 3, rework: 0, possible_fix: 0 } }).join('\n');
  assert.match(lines, /Rework \(named reverts\) within 72 hours: n\/a, no episode in a repo with git history read has a linked commit\./);
  assert.match(lines, /Unlinked commits: 12 episodes/);
  assert.match(lines, /History not read: 3 episodes ran a commit command in a repo whose git history was not read, left out of rework and commit-link counts\./);
  const one = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, history_unread: 1 } }).join('\n');
  assert.match(one, /History not read: 1 episode ran/);
  assert.doesNotMatch(usageLines(SAMPLE_USAGE).join('\n'), /History not read/);
});

test('one project over 60% of episodes: a usage line and a note on every rate line; at 60% or under, neither', () => {
  const at = (share, projects = 3) => usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, episodes: 100, projects, top_project_episodes: Math.round(share * 100), top_project_share: share } });
  const over = at(0.61);
  assert.ok(over.includes('One project dominates: 61 of 100 episodes (61%) come from 1 of 3 projects, so every rate here mostly describes that project.'), over.join('\n'));
  for (const re of [/^Subagent share/, /^Identical tool-call retries/, /^Done claims with no test/, /^Rework \(named reverts\)/, /^Possible rework \(file overlap\)/]) {
    assert.match(over.find((l) => re.test(l)), /Mostly 1 project: 61% of episodes\.$/, String(re));
  }
  assert.doesNotMatch(over.find((l) => /^Correction candidates/.test(l)), /Mostly/, 'a count is not a rate');
  for (const lines of [at(0.6), at(0.4)]) assert.doesNotMatch(lines.join('\n'), /One project|Mostly 1 project/);
  assert.match(at(1, 1).join('\n'), /One project: all 100 episodes come from 1 project, so every rate here describes that project only\./);
  assert.equal(copy.dominanceLine({ episodes: 0, projects: 0, top_project_episodes: 0, top_project_share: null }), null);
});

test('dropped-before-counting line names resent messages and forked sessions, and is absent when nothing was dropped', () => {
  const text = usageLines(SAMPLE_USAGE).join('\n');
  assert.match(text, /Dropped before counting: 9 resent messages \(the same text sent again after an interrupt or an unanswered send\), and 41 copied messages in 3 session files that repeat lines already read \(a fork, a resume, or one session saved in 2 folders; 1 of 3 files had nothing new and was left out\)\./);
  const none = usageLines({ ...SAMPLE_USAGE, counts: { ...SAMPLE_USAGE.counts, resent_messages: 0, forked_sessions: 0, copied_messages: 0, forked_sessions_dropped: 0 } }).join('\n');
  assert.doesNotMatch(none, /Dropped before counting/);
  assert.doesNotMatch(usageLines({ ...SAMPLE_USAGE, counts: { sessions: 1, episodes: 1, human_turns: 1, interrupts: 0, compactions: 0, correction_candidates: 0 } }).join('\n'), /Dropped before counting|undefined/);
});

test('counts are human messages: the line says a message with several cues counts once', () => {
  const text = usageLines(SAMPLE_USAGE).join('\n');
  assert.match(text, /1171 human messages, 22 interrupts/);
  assert.match(text, /Correction candidates: 40 human messages, each counted once however many cues it holds\./);
});

test('Gate B need line: one plain sentence per history-size rule', () => {
  const lines = {
    none: copy.needLine({ consented: false }),
    empty: copy.needLine({ consented: true, rule: 'setup_only', sessions: 0, human_messages: 0, span_days: 0 }),
    thin: copy.needLine({ consented: true, rule: 'limited', sessions: 6, human_messages: 40, span_days: 5 }),
    enough: copy.needLine({ consented: true, rule: 'probe', sessions: 66, human_messages: 1171, span_days: 30 }),
    few: copy.needLine({ consented: true, rule: 'probe', sessions: 12, human_messages: 19, span_days: 30 }),
    brief: copy.needLine({ consented: true, rule: 'probe', sessions: 12, human_messages: 300, span_days: 6 }),
  };
  for (const k of ['few', 'brief']) assert.match(lines[k], /^Do you need more than a scan yet\? Not yet: .* is a short history, under 20 messages or 7 days, so a scan is all it supports\.$/, k);
  assert.match(copy.needLine({ consented: true, rule: 'probe', sessions: 10, human_messages: 20, span_days: 7 }), /Maybe:/, 'at the bars, enough');
  assert.equal(lines.none, 'Do you need more than a scan yet? Unknown: session history was not read.');
  assert.equal(lines.thin, 'Do you need more than a scan yet? Not yet: 6 sessions and 40 of your messages over 5 days is limited history, under 10 sessions, so a scan is all it supports.');
  assert.equal(lines.enough, 'Do you need more than a scan yet? Maybe: 66 sessions and 1171 of your messages over 30 days is enough history for a deeper look; this version offers the scan only.');
  assert.match(lines.empty, /^Do you need more than a scan yet\? Unknown/);
  for (const l of Object.values(lines)) {
    assert.ok(!l.includes('\n'), 'one line');
    assert.deepEqual(copyProblems(l), [], l);
  }
});

test('control sentence labels a small flagged group and drops an empty one', () => {
  const dwt = (flagged) => ({ ...SAMPLE_PROBES.done_without_test, control: { flagged, rest: { hits: 2, n: 40, rate: 0.05 }, diff_points: 0 } });
  const one = copy.finding('done_without_test', dwt({ hits: 1, n: 1, rate: 1 })).why.join(' ');
  assert.match(one, /1 of 1 flagged episode with linked commits \(100%, a small sample under 15 episodes\)/);
  const none = copy.finding('done_without_test', dwt({ hits: 0, n: 0, rate: 0 })).why.join(' ');
  assert.doesNotMatch(none, /0 of 0/);
  assert.match(none, /No control comparison: no flagged episode has a linked commit\./);
  const big = copy.finding('done_without_test', dwt({ hits: 3, n: 20, rate: 0.15 })).why.join(' ');
  assert.match(big, /3 of 20 flagged episodes with linked commits \(15%\)/);
});
