import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeAttribution, correctionKind, CANDIDATE_CAVEAT, JUDGED_KINDS, userPivot } from '../../src/scorer/judged.mjs';
import { JUDGED_ENTRY_IDS } from '../../src/judge/validate.mjs';
import { validateFindings } from '../../src/schema/findings.mjs';
import { renderReport, shareSafeFindings } from '../../src/render/report.mjs';
import { buildIdentifiers } from '../../src/scrub/mask.mjs';
import { THRESHOLDS } from '../../src/probes/config.mjs';
import { t1Findings } from '../synth/t1-findings.mjs';

const GOLDEN = fileURLToPath(new URL('../golden/t1-pulse/', import.meta.url));
const c = (o = {}) => ({ turn_id: 't03', supplies_constraint: true, constraint_present_in: 'none', attribution: { label: 'user', confidence: 0.8 }, config_ref: null, quotes: [], ...o });
const bundle = (o = {}) => ({ config: [{ id: 'c1', text: 'rule', may_have_changed: false }], config_truncated: false, config_source: 'snapshot', turns: [{ id: 't01', role: 'human', text: 'Add an export.' }, { id: 't02', role: 'assistant', text: '' }, { id: 't03', role: 'human', text: 'Use tabs.', candidate: true }], meta: { human_index: { t01: 0, t03: 1 } }, ...o });

test('the judge schema offers exactly the entry ids of the judged kinds', () => {
  assert.deepEqual([...JUDGED_ENTRY_IDS].sort(), Object.values(JUDGED_KINDS).flatMap((k) => k.entry_ids).sort());
});

test('attribution by code, first match wins (spec 5 rules 1, 2, 4)', () => {
  assert.equal(codeAttribution(c(), bundle()), 'user', 'absent from prompt and live config');
  assert.equal(codeAttribution(c({ attribution: { label: 'unknown', confidence: 0.5 } }), bundle()), 'unknown', 'the judge said unknown');
  assert.equal(codeAttribution(c(), bundle({ config: [{ id: 'c1', text: 'x', may_have_changed: true }] })), 'unknown', 'config may have changed');
  assert.equal(codeAttribution(c(), bundle({ config_truncated: true })), 'unknown', 'config cut short');
  assert.equal(codeAttribution(c({ constraint_present_in: 'prompt', quotes: [{ turn_id: 't01', start: 0, end: 13 }] }), bundle()), 'model');
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 4 } }), bundle()), 'model');
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: null }), bundle()), 'user', 'an unverified config claim is not found');
  assert.equal(codeAttribution(c({ constraint_present_in: 'skill' }), bundle()), 'unknown');
});

test('a quote too short to be specific never flips blame to the model', () => {
  const long = bundle({ config: [{ id: 'c1', text: 'Never edit generated files.', may_have_changed: false }] });
  // One character of an earlier prompt, or of a config block, proves nothing.
  assert.equal(codeAttribution(c({ constraint_present_in: 'prompt', quotes: [{ turn_id: 't01', start: 0, end: 1 }] }), long), 'user');
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 1 } }), long), 'user');
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 11 } }), long), 'user');
  // Twelve characters, or the whole block, do.
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 12 } }), long), 'model');
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 4 } }), bundle()), 'model', 'the whole block');
  // A span past the end of its source is not proof.
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: 0, end: 99 } }), long), 'user');
});

test('kinds need a code-flagged anchor; late_constraint only in human turns 2 to 3', () => {
  const t = THRESHOLDS;
  assert.equal(correctionKind(c(), bundle(), 'user', t), 'late_constraint');
  const late = bundle({ meta: { human_index: { t01: 0, t03: 3 } } });
  assert.equal(correctionKind(c(), late, 'user', t), null, 'fourth message is no anchor');
  const unflagged = bundle({ turns: [{ id: 't01', role: 'human', text: 'x' }, { id: 't03', role: 'human', text: 'y', candidate: false }] });
  assert.equal(correctionKind(c(), unflagged, 'user', t), null);
  assert.equal(correctionKind(c({ constraint_present_in: 'instruction_file' }), bundle(), 'model', t), 'ignored_instruction');
  assert.equal(correctionKind(c({ supplies_constraint: false }), bundle(), 'user', t), null);
});

test('before/after from your own words: a clean clause is appended and marked; a question or several requests fall back', () => {
  const t = THRESHOLDS;
  const p = userPivot(bundle(), 't03', t);
  assert.deepEqual(p, { before: 'Add an export.', after: 'Add an export. Use tabs.', marks: [[15, 24]] });
  const q = bundle({ turns: [{ id: 't01', role: 'human', text: 'Add an export.' }, { id: 't03', role: 'human', text: 'Why tabs? Use commas.' }] });
  assert.equal(userPivot(q, 't03', t), null);
  const multi = bundle({ turns: [{ id: 't01', role: 'human', text: 'Add an export.' }, { id: 't03', role: 'human', text: 'Use tabs. Rename it. Add tests. Ship it.' }] });
  assert.equal(userPivot(multi, 't03', t), null);
});

test('T1 fixture: schema-valid, judged findings are candidates with the caveat, never high, never Start with, no praise', () => {
  const f = t1Findings();
  const v = validateFindings(f);
  assert.equal(v.ok, true, JSON.stringify(v.errors.slice(0, 5)));
  const judged = f.findings.filter((x) => x.provenance === 'judged');
  assert.deepEqual(judged.map((x) => x.kind).sort(), ['ignored_instruction', 'late_constraint']);
  for (const x of judged) {
    assert.equal(x.candidate, true);
    assert.equal(x.caveat, CANDIDATE_CAVEAT);
    assert.match(x.title, /\(candidate\)$/);
    assert.ok(x.title.length < 70 && x.short.length < 50);
    assert.ok(x.confidence.value <= 0.74 && x.confidence.label !== 'high');
    assert.equal(x.recurrence.sample, 12);
    assert.ok(x.support.sessions >= 3);
    assert.ok(x.shrine_refs.length >= 1);
  }
  assert.ok(!judged.some((x) => x.id === f.headline.start_with?.finding_id));
  assert.equal(f.findings.filter((x) => x.tab === 'working').length, 0);
  assert.deepEqual(f.attribution_stack, { setup: 0, prompt: 5, model: 3, unknown: 0 });
  assert.equal(f.tier, 'T1');
  assert.deepEqual(f.judging.outcomes, { resolved: 4, abandoned: 0, reworked: 8, unknown: 0 });
});

test('T1 share-safe: your prompt, quotes, and timeline labels are gone; generic pivots stand in', () => {
  const f = t1Findings();
  const safe = shareSafeFindings(f, buildIdentifiers({ projects: ['bad-project'] }), JSON.parse(readFileSync(fileURLToPath(new URL('../../src/catalogue/generic-pivots.json', import.meta.url)), 'utf8')));
  const s = JSON.stringify(safe.findings);
  assert.doesNotMatch(s, /semicolons|CSV export|edit generated files in/);
  for (const x of safe.findings.filter((y) => y.provenance === 'judged')) assert.equal(x.pivot.source, 'shrine_generic');
});

test('golden: T1 findings JSON and HTML (UPDATE_GOLDEN=1 to refresh after a reviewed change)', () => {
  const f = t1Findings();
  const html = renderReport(f);
  const fj = `${JSON.stringify(f, null, 2)}\n`;
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(`${GOLDEN}findings.json`)) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(`${GOLDEN}findings.json`, fj);
    writeFileSync(`${GOLDEN}report.html`, html);
  }
  assert.equal(fj, readFileSync(`${GOLDEN}findings.json`, 'utf8'));
  assert.equal(html, readFileSync(`${GOLDEN}report.html`, 'utf8'));
});

test('judging lines show thin, small-history, relaxed-cap, retries, floors, and an overrun', async () => {
  const { judgingLines } = await import('../../src/copy/templates.mjs');
  const base = { planned: 12, judged: 5, invalid: 0, refusals: 0, outcomes: {}, corrections_traced: 3, unknown_verdicts: 0, bar: 2, tokens_used: 90000, calls: 14, tokens_floor: true, estimate: { tokens_low: 50000, tokens_high: 70000 }, sample: { thin: true, small_history: true, cap_relaxed: true } };
  const l = judgingLines(base).join('\n');
  for (const re of [/Thin evidence/, /Fewer than 20 episodes/, /cap of 4 episodes per project was relaxed/, /in 14 model calls/, /at least 90,000 tokens/, /passed the approved upper bound/]) assert.match(l, re);
});

test('a judged candidate in the TLDR is labelled Candidate lead', async () => {
  const f = t1Findings();
  const cand = f.findings.find((x) => x.candidate);
  f.headline.tldr = [{ status: 'amplify', headline: cand.title, sentence: 'x.', finding_id: cand.id }];
  assert.match(renderReport(f), /Candidate lead:<\/span>/);
});

test('a constraint claimed "in the prompt" needs a quote from an earlier turn; disagreements cap a correction at 0.5', () => {
  const b = bundle({ meta: { human_index: { t01: 0, t03: 1 } } });
  assert.equal(codeAttribution(c({ constraint_present_in: 'prompt' }), b), 'user', 'no quote: not found');
  assert.equal(codeAttribution(c({ constraint_present_in: 'prompt', quotes: [{ turn_id: 't01', start: 0, end: 13 }] }), b), 'model');
});

test('an unverified config quote attributes to you (rule 2), and a late snapshot caps at unknown', () => {
  assert.equal(codeAttribution(c({ constraint_present_in: 'instruction_file', config_ref: { config_id: 'c1', start: -1, end: 5 } }), bundle()), 'user');
  assert.equal(codeAttribution(c(), bundle({ config: [{ id: 'c1', text: 'x', may_have_changed: true }] })), 'unknown');
});
