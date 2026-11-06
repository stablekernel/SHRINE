// A deterministic T1 findings.json for golden, render, and visual tests, built
// through the real bundle builder, validator, judged scorer, and merge: 12
// judged episodes, 5 with a late constraint, 3 with a restated loaded rule, on
// top of the T0 bad-setup history findings. Fixed nonces; no model, no IO
// beyond the bundled catalogue and pivots.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '../../src/judge/bundle.mjs';
import { validateJudgment } from '../../src/judge/validate.mjs';
import { createWorkOrder } from '../../src/judge/workorder.mjs';
import { judgedFindings, mergeJudged } from '../../src/scorer/judged.mjs';
import { buildIdentifiers } from '../../src/scrub/mask.mjs';
import { copy } from '../../src/copy/templates.mjs';
import { THRESHOLDS } from '../../src/probes/config.mjs';
import { t0HistoryFindings } from './t0-findings.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const at = (d, m) => new Date(Date.UTC(2026, 9, 8 + d, 9, m)).toISOString();
const RULES = '# Project rules\n- Never edit generated files under the generated client folder.\n- Run npm test before you report done.\n';

function episode(i) {
  const kind = i < 5 ? 'late' : i < 8 ? 'ignored' : 'quiet';
  const events = [{ t: at(i, 0), kind: 'human', uuid: `u${i}`, text: kind === 'ignored' ? `Update the API client for endpoint ${i}.` : `Add a CSV export to report ${i}.` }, { t: at(i, 1), kind: 'usage', tokens: 6000 }, { t: at(i, 1), kind: 'assistant_text', text: 'Added.', head: 'Added the first version of the change.' }, { t: at(i, 1), kind: 'tool_use', name: 'Edit' }];
  if (kind === 'late') events.push({ t: at(i, 4), kind: 'human', uuid: `v${i}`, text: 'Actually, use semicolons as the separator and keep the header row.' });
  if (kind === 'ignored') events.push({ t: at(i, 6), kind: 'human', uuid: `v${i}`, text: "Don't edit generated files in the generated client folder, regenerate them instead." });
  if (kind === 'quiet') events.push({ t: at(i, 3), kind: 'human', uuid: `v${i}`, text: 'Now add a docstring.' });
  events.push({ t: at(i, 7), kind: 'usage', tokens: 9000 }, { t: at(i, 8), kind: 'assistant_text', text: 'Done.' });
  const ep = { id: `e-${String(i).padStart(12, '0')}`, session_id: `s-${i}`, root_turn_id: `u${i}`, start: at(i, 0), end: at(i, 9), terminal: i % 2 ? 'commit' : 'session_end', repo: '/work/bad-project', stratum: { project: 'bad-project' } };
  return { ep, kind, transcript: { events, snapshot: [{ path: '/work/bad-project/CLAUDE.md', content: RULES }] } };
}

function output(b, kind) {
  const base = { episode_id: b.episode_id, nonce: b.nonce, outcome: kind === 'quiet' ? 'resolved' : 'reworked', corrections: [] };
  if (kind === 'late') base.corrections.push({ turn_id: 't03', kind: 'constraint', supplies_constraint: true, constraint_present_in: 'none', attribution: { label: 'user', confidence: 0.8 }, sufficiency: 'enough', quotes: [{ turn_id: 't03', text: 'use semicolons as the separator' }], entry_ids: ['problem-before-prescription.sov.late-constraint'] });
  if (kind === 'ignored') base.corrections.push({ turn_id: 't03', kind: 'constraint', supplies_constraint: true, constraint_present_in: 'instruction_file', attribution: { label: 'model', confidence: 0.7 }, sufficiency: 'enough', quotes: [{ turn_id: 't03', text: "Don't edit generated files" }], config_ref: { config_id: 'c1', text: 'Never edit generated files under the generated client folder.' }, entry_ids: ['authority-cascade.sov.rule-practice-gap'] });
  return base;
}

// extra: more judgments.jsonl lines; late: a limit passed on the last episode.
export function t1Findings({ extra = [], late = null } = {}) {
  const known = buildIdentifiers({ projects: ['bad-project'] });
  const eps = Array.from({ length: 12 }, (_, i) => episode(i));
  const bundles = eps.map((e, i) => buildBundle({ episode: e.ep, transcript: e.transcript, known, nonce: `0000${String(i).padStart(4, '0')}` }));
  const order = createWorkOrder({ runId: 't1-visual', seed: 4242, bundles, estimate: { calls: 12, tokens_low: 52000, tokens_high: 74000, minutes: 5 }, caps: {} });
  const lines = bundles.map((b, i) => {
    const v = validateJudgment(output(b, eps[i].kind), b);
    if (!v.ok) throw new Error(`fixture judgment ${i} invalid: ${v.errors.join('; ')}`);
    return { judge: 'episode_classifier', judge_version: 1, model_id: 'fixture-model', episode_id: b.episode_id, valid: true, output: v.output, attempts: 1, refusal: false, errors: [], latency_ms: 21000, tokens: { in: 3800, out: 400, cache_read: 0, cache_write: 0, total: 4200 } };
  });
  const episodes = new Map(eps.map((e) => [e.ep.id, e.ep]));
  const judged = judgedFindings({ lines: [...lines, ...extra], late, order, episodes, catalogue: load('../../src/catalogue/catalogue.json'), pivots: load('../../src/catalogue/generic-pivots.json'), copy, t: THRESHOLDS });
  const base = t0HistoryFindings();
  base.run = { ...base.run, id: 't1-visual', seed: 4242 };
  const sample = { seed: 4242, size: 12, eligible: 30, total_episodes: 136, thin: false, small_history: false, cap_relaxed: true };
  const merged = mergeJudged(base, judged, { reviewers: 1, minutes: 4.2, sample, estimate: order.estimate });
  merged.judging.lines = copy.judgingLines(merged.judging);
  return merged;
}
