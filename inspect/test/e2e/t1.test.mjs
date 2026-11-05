// T1 end to end with the fake judge (plan T1 tasks 4, 5, 8a): Gate B consent,
// zero spawns without a yes, planted histories, read-only proof, and the report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fakeJudge, inproc, judgeSpawns, json, lines, piped, plantedHome, runDir, runT1, silentTty, stateDir, tty } from './t1-helpers.mjs';

function treeHash(root) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = lstatSync(p);
      h.update(`${relative(root, p)}|${s.mode}|${s.size}|${s.mtimeMs}\n`);
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) h.update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest('hex');
}

test('T1 pauses at Gate B without a terminal: zero judge spawns, no work order, the itemized offer in gate.json', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const state = stateDir();
  const r = await inproc(['run', '--tier', 'T1', '--json'], h, state, { stdin: tty('history') });
  assert.equal(r.code, 3, r.stderr);
  const dir = runDir(state);
  const g = json(dir, 'gate.json');
  assert.equal(g.gate, 'B');
  assert.deepEqual(g.choices, ['T0', 'T1']);
  assert.equal(g.offer.episodes, 12);
  assert.ok(g.offer.tokens_low > 0 && g.offer.tokens_high > g.offer.tokens_low);
  assert.ok(g.offer.minutes >= 1);
  assert.ok(g.lines.some((l) => /^Tier T0 \(pre-selected\)/.test(l)));
  assert.ok(g.lines.some((l) => /judge 12 episodes from .*, about [\d,]+ to [\d,]+ tokens on your own account, about \d+ minutes?\./.test(l)));
  assert.equal(json(dir, 'state.json').gates.B, null);
  assert.ok(!existsSync(join(dir, 'workorder.json')), 'no work order before a yes');
  assert.ok(!existsSync(join(dir, 'judgments.jsonl')));
  // The sample is drawn at scan time and holds ids and counts only.
  const sample = json(dir, 'sample.json');
  assert.equal(sample.seed, 4242);
  assert.equal(sample.episode_ids.length, 12);
  assert.doesNotMatch(JSON.stringify(sample), /semicolons|CSV/);
  // Silence (an ended terminal), piped stdin, and a non-yes answer all stay paused.
  const runId = dir.split('/').at(-1);
  for (const stdin of [silentTty(), piped('yes'), tty('maybe')]) {
    const a = await inproc(['approve', runId, 'B', '--json'], h, state, { stdin });
    assert.equal(a.code, 3, a.stderr);
    assert.equal(json(dir, 'state.json').gates.B, null);
  }
  assert.equal(lines(dir, 'judgments.jsonl').length, 0);
  assert.ok(!existsSync(join(dir, 'workorder.json')));
  h.cleanup();
});

test('T1 inline Gate B: silence leaves the run paused with zero spawns', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const state = stateDir();
  // Gate A gets "history"; the same terminal then ends, so Gate B hears nothing.
  const r = await inproc(['run', '--tier', 'T1', '--json'], h, state, { stdin: tty('history') });
  assert.equal(r.code, 3);
  const dir = runDir(state);
  assert.equal(json(dir, 'state.json').phase, 'gate_b');
  const spy = lines(dir, 'spy.jsonl');
  assert.equal(spy.length, 0, 'a paused run writes no spy log yet');
  h.cleanup();
});

test('T1 answered T0 at Gate B: scan only, zero judge spawns', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const r = await runT1(h, { choice: 'T0' });
  assert.equal(r.second.code, 0, r.second.stderr);
  const f = json(r.dir, 'findings.json');
  assert.equal(f.tier, 'T0');
  assert.equal(judgeSpawns(r.dir).length, 0);
  assert.ok(!existsSync(join(r.dir, 'workorder.json')));
  assert.equal(json(r.dir, 'facts.json').consent.B.choice, 'T0');
  h.cleanup();
});

test('planted late constraint: a candidate late_constraint finding, owner You, with the caveat and N', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const before = treeHash(h.tmp);
  const r = await runT1(h);
  assert.equal(r.second.code, 0, r.second.stderr);
  assert.equal(treeHash(h.tmp), before, 'fixture home and repo unchanged');
  const f = json(r.dir, 'findings.json');
  assert.equal(f.tier, 'T1');
  assert.equal(f.run.seed, 4242);
  const lc = f.findings.find((x) => x.kind === 'late_constraint');
  assert.ok(lc, 'late_constraint raised');
  assert.equal(lc.provenance, 'judged');
  assert.equal(lc.candidate, true);
  assert.match(lc.caveat, /Its accuracy is not yet measured/);
  assert.equal(lc.attribution, 'user');
  assert.equal(lc.owner_label, 'Owner: You');
  assert.notEqual(lc.confidence.label, 'high');
  assert.ok(lc.confidence.value <= 0.74);
  assert.equal(lc.recurrence.sample, 12);
  assert.equal(lc.short, `${lc.recurrence.hits} of 12 judged episodes`);
  assert.equal(lc.pivot.source, 'user_prompt');
  assert.match(lc.pivot.after_scrubbed, /use semicolons/);
  assert.ok(lc.shrine_refs.every((x) => x.url_pinned.startsWith('https://github.com/stablekernel/SHRINE/blob/')));
  assert.notEqual(f.headline.start_with?.finding_id, lc.id, 'a candidate is never Start with');
  assert.ok(f.attribution_stack.prompt >= 12);
  assert.equal(f.judging.judged, 12);
  assert.equal(judgeSpawns(r.dir).length, 12, 'one process per episode');
  const facts = json(r.dir, 'facts.json');
  assert.equal(facts.consent.B.choice, 'T1');
  assert.equal(facts.consent.B.by, 'tty');
  assert.ok(facts.consent.B.estimate.tokens_high > 0);
  // Read-only: writes only under the state dir; spawns only git and the armed judge.
  const stateRoot = join(r.state, 'state');
  for (const e of lines(r.dir, 'spy.jsonl')) {
    if (e.op === 'write') assert.ok(e.path.startsWith(stateRoot), `write outside state: ${e.path}`);
    if (e.op === 'open') assert.equal(e.mode, 'r');
    if (e.op === 'spawn') assert.ok(e.cmd === 'git' || (e.judge && e.cmd === process.execPath), `spawn ${e.cmd}`);
  }
  const html = readFileSync(join(r.dir, 'report.html'), 'utf8');
  assert.match(html, /Tier 1, Pulse/);
  assert.match(html, /<span class="tag">Candidate<\/span>/);
  assert.match(html, /Its accuracy is not yet measured/);
  assert.match(html, /Judging \(Tier 1\)/);
  assert.match(html, /Seed 4242/);
  // Share-safe: the person's own prompt and every quote are gone.
  const safe = readFileSync(join(r.dir, 'report.share-safe.html'), 'utf8');
  assert.doesNotMatch(safe, /semicolons/);
  assert.match(safe, /Example from SHRINE/);
  h.cleanup();
});

test('planted ignored rule: an ignored_instruction candidate, owner Model, quoted from the loaded CLAUDE.md', async () => {
  const h = plantedHome([['ignored', 12, 'bbbb']]);
  const r = await runT1(h);
  assert.equal(r.second.code, 0, r.second.stderr);
  const f = json(r.dir, 'findings.json');
  const ii = f.findings.find((x) => x.kind === 'ignored_instruction');
  assert.ok(ii, 'ignored_instruction raised');
  assert.equal(ii.attribution, 'model');
  assert.equal(ii.owner_label, 'Owner: Model');
  assert.equal(ii.candidate, true);
  assert.ok(!f.findings.some((x) => x.kind === 'late_constraint'), 'a loaded rule is not a late constraint');
  assert.ok(f.attribution_stack.model >= 12);
  h.cleanup();
});

test('quiet history: corrections come late and match no rule, so no judged finding and nothing above low', async () => {
  const h = plantedHome([['quiet', 12, 'cccc']]);
  const r = await runT1(h);
  assert.equal(r.second.code, 0, r.second.stderr);
  const f = json(r.dir, 'findings.json');
  assert.ok(!f.findings.some((x) => x.provenance === 'judged'));
  assert.ok(!f.findings.some((x) => x.tab === 'amplify' && x.severity.label !== 'low' && x.lens !== 'config'));
  assert.ok(!f.findings.some((x) => x.tab === 'working'), 'no judged praise');
  assert.equal(f.judging.judged, 12);
  h.cleanup();
});

test('invalid answers past 10% stop judging at Gate C; keep gives a partial report', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const r = await runT1(h, { judge: fakeJudge('invalid') });
  assert.equal(r.second.code, 3, 'Gate C waits');
  assert.equal(json(r.dir, 'gate.json').gate, 'C');
  assert.equal(json(r.dir, 'state.json').abort.reason, 'errors');
  const judged = lines(r.dir, 'judgments.jsonl');
  assert.equal(judged.length, 2, 'stopped after 2 of 12 invalid');
  assert.ok(judged.every((l) => !l.valid && l.attempts === 2 && l.output === null));
  const k = await inproc(['approve', r.runId, 'C', 'keep', '--json'], h, r.state, { stdin: tty('yes'), judge: fakeJudge('auto') });
  assert.equal(k.code, 0, k.stderr);
  const f = json(r.dir, 'findings.json');
  assert.equal(f.judging.partial, true);
  assert.equal(lines(r.dir, 'judgments.jsonl').length, 2, 'keep never judges more');
  h.cleanup();
});

test('a usage limit stops judging apart from errors; stop keeps the scan only', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const r = await runT1(h, { judge: fakeJudge('limit') });
  assert.equal(r.second.code, 3);
  assert.equal(json(r.dir, 'state.json').abort.reason, 'limit');
  const s = await inproc(['approve', r.runId, 'C', 'stop', '--json'], h, r.state, { stdin: tty('yes'), judge: fakeJudge('auto') });
  assert.equal(s.code, 0, s.stderr);
  const f = json(r.dir, 'findings.json');
  assert.equal(f.tier, 'T0');
  assert.ok(f.notes.some((n) => /stopped early at Gate C/.test(n)));
  h.cleanup();
});

test('one retry with the validator error: invalid then valid gives a valid line', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const r = await runT1(h, { judge: fakeJudge('invalid-once') });
  assert.equal(r.second.code, 0, r.second.stderr);
  const judged = lines(r.dir, 'judgments.jsonl');
  assert.equal(judged.length, 12);
  assert.ok(judged.every((l) => l.valid && l.attempts === 2));
  h.cleanup();
});

test('no judge on this harness: Gate B offers T0 only and the report says why', async () => {
  const h = plantedHome([['late', 12, 'aaaa']]);
  const state = stateDir();
  const judge = { available: { ok: false, reason: 'no claude command on PATH' }, invocation: null, parse: () => null };
  const r = await inproc(['run', '--tier', 'T1', '--json'], h, state, { stdin: tty('history'), judge });
  assert.equal(r.code, 0, r.stderr);
  const f = json(runDir(state), 'findings.json');
  assert.equal(f.tier, 'T0');
  assert.ok(f.notes.some((n) => /not available on this harness \(no claude command on PATH\)/.test(n)));
  h.cleanup();
});

test('limited history (under 10 sessions): T1 is not offered', async () => {
  const h = plantedHome([['late', 5, 'aaaa']]);
  const state = stateDir();
  const r = await inproc(['run', '--tier', 'T1', '--json'], h, state, { stdin: tty('history') });
  assert.equal(r.code, 0, r.stderr);
  const f = json(runDir(state), 'findings.json');
  assert.equal(f.tier, 'T0');
  assert.ok(f.notes.some((n) => /needs 10 or more sessions/.test(n)));
  assert.equal(judgeSpawns(runDir(state)).length, 0);
  h.cleanup();
});
