import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copy, sampleCopy, SAMPLE_PROBES, emptyStates } from '../../src/copy/templates.mjs';
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
  const b = copy.finding('oversized_instructions', { ...SAMPLE_PROBES.oversized_instructions, metric: { ...SAMPLE_PROBES.oversized_instructions.metric, kb: 77 } });
  assert.match(b.title, /77 KB/);
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
