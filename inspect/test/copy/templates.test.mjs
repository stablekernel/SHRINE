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
