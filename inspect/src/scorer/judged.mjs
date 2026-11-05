// Scorer, judged kinds at T1 (spec 4 and 5, plan T1 task 6, thin slice). Joins
// valid judgments with the bundles they judged. Code decides attribution (rules
// 1, 2, and 4 of spec 5; rule 3, buried instructions, is not in this slice); the
// judge's own label is advisory and a disagreement caps confidence at 0.5. Every
// finding is a candidate: confidence never reaches the high label, it never
// becomes "Start with", and it carries a plain caveat. No judged praise.
// Re-runnable from stored files; no IO.
import { findingId } from './score.mjs';
import { usageSeverity } from './stats.mjs';

export const JUDGED_KINDS = {
  late_constraint: { entry_ids: ['problem-before-prescription.sov.late-constraint'], attribution: 'user', icon: 'compass' },
  ignored_instruction: { entry_ids: ['authority-cascade.sov.rule-practice-gap'], attribution: 'model', icon: 'layers' },
};
export const CANDIDATE_CAVEAT = 'A model read these episodes. Its accuracy is not yet measured. Treat this as a lead, not a verdict.';
const OWNER = { user: 'Owner: You', harness: 'Owner: Setup', model: 'Owner: Model', unknown: 'Owner: Could not tell' };
const STACK_KEY = { user: 'prompt', harness: 'setup', model: 'model', unknown: 'unknown' };

const hhmm = (iso) => (typeof iso === 'string' && iso.length >= 16 ? `${iso.slice(11, 16)} UTC` : '');
const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));

// Spec 5 attribution, first match wins: 1) unknown when the judge says unknown or
// the live config may have changed (or was cut short); 2) user when the
// constraint was in neither the root prompt nor the live config; 4) model when it
// was in an earlier prompt or, verified by an exact quote, in a loaded config
// block. A config claim whose quote did not verify is "not found" (rule 2).
export function codeAttribution(c, bundle) {
  if (c.attribution.label === 'unknown' || c.constraint_present_in === 'unknown' || c.constraint_present_in === 'skill') return 'unknown';
  const unsure = bundle.config_truncated || bundle.config.some((x) => x.may_have_changed);
  if (unsure) return 'unknown';
  // "In the prompt" counts only with a quote from an earlier human turn of this episode.
  if (c.constraint_present_in === 'prompt') {
    const at = bundle.meta.human_index[c.turn_id];
    const earlier = c.quotes.some((q) => q.start >= 0 && bundle.meta.human_index[q.turn_id] != null && bundle.meta.human_index[q.turn_id] < at);
    return earlier ? 'model' : 'user';
  }
  if (c.constraint_present_in === 'instruction_file' && c.config_ref && c.config_ref.start >= 0) return 'model';
  return 'user';
}

// Kind of one anchored correction, or null. Anchor: a code correction candidate;
// late_constraint also needs it in human turns 2 to 3.
export function correctionKind(c, bundle, code, t) {
  const turn = bundle.turns.find((x) => x.id === c.turn_id);
  if (!turn?.candidate || !c.supplies_constraint) return null;
  if (code === 'user' && t.judged.anchor_turns.includes(bundle.meta.human_index[c.turn_id])) return 'late_constraint';
  if (code === 'model' && c.constraint_present_in === 'instruction_file') return 'ignored_instruction';
  return null;
}

// Before/after from the person's own words: the root prompt, then the root
// prompt with the correction appended as one clause. Null when the clause cannot
// be isolated (long, a question, or several requests); the generic pivot is used.
export function userPivot(bundle, turnId, t) {
  const root = bundle.turns.find((x) => x.role === 'human');
  const corr = bundle.turns.find((x) => x.id === turnId);
  if (!root || !corr) return null;
  const clause = corr.text.trim().replace(/\s+/g, ' ');
  const sentences = clause.split(/(?<=[.!])\s+/).filter(Boolean);
  if (!clause || clause.length > t.judged.before_after.clause_chars || clause.includes('?') || sentences.length > 2 || /\n\s*[-*\d]/.test(corr.text)) return null;
  const max = t.judged.before_after.root_chars;
  const r = root.text.trim();
  const before = r.length > max ? `${r.slice(0, max).trimEnd()}...` : r;
  const after = `${before} ${clause}`;
  return { before, after, marks: [[before.length + 1, after.length]] };
}

function ref(catalogue, entryId) {
  const e = catalogue.entries[entryId];
  if (!e) return null;
  return { entry_id: e.entry_id, page_id: e.page_id, anchor: e.anchor, title: e.title, section: e.section, status: e.status, url: e.url, url_pinned: e.url_pinned, quote: e.quote };
}

// lines: judgments.jsonl; order: the work order (bundles); episodes: Map(id ->
// facts episode); partial: true when Gate C kept partial results.
export function judgedFindings({ lines, order, episodes, catalogue, pivots, copy, t, partial = false }) {
  const J = t.judged;
  const bundles = new Map(order.items.map((i) => [i.episode_id, i.bundle]));
  const valid = lines.filter((l) => l.valid && bundles.has(l.episode_id));
  const N = valid.length;
  const outcomes = { resolved: 0, abandoned: 0, reworked: 0, unknown: 0 };
  const stack = { setup: 0, prompt: 0, model: 0, unknown: 0 };
  const hits = { late_constraint: [], ignored_instruction: [] };
  let unknownVerdicts = 0;
  let traced = 0;
  for (const l of valid) {
    const b = bundles.get(l.episode_id);
    outcomes[l.output.outcome]++;
    for (const c of l.output.corrections) {
      const turn = b.turns.find((x) => x.id === c.turn_id);
      // Only corrections on a code-flagged candidate turn count anywhere.
      if (!turn?.candidate) continue;
      traced++;
      const code = codeAttribution(c, b);
      if (code === 'unknown') unknownVerdicts++;
      stack[STACK_KEY[code]]++;
      const kind = correctionKind(c, b, code, t);
      if (kind) hits[kind].push({ line: l, c, code, bundle: b, agree: c.attribution.label === code });
    }
  }
  const bar = Math.max(J.bar_min, Math.min(J.bar_episodes, Math.ceil(J.bar_share * N)));
  const findings = [];
  const dropped = [];
  for (const [kind, spec] of Object.entries(JUDGED_KINDS)) {
    const list = hits[kind];
    const eps = [...new Set(list.map((h) => h.line.episode_id))];
    if (!eps.length) continue;
    const id = findingId(kind, spec.entry_ids[0], 'judged');
    if (eps.length < bar) {
      dropped.push({ id, reason: `${kind}: ${eps.length} of ${N} judged episodes, under the bar of ${bar}` });
      continue;
    }
    const refs = spec.entry_ids.map((e) => ref(catalogue, e)).filter(Boolean);
    const generic = pivots[spec.entry_ids[0]];
    if (!refs.length || !generic) {
      dropped.push({ id, reason: `no catalogue entry or pivot for ${kind}` });
      continue;
    }
    const C = J.confidence;
    const agreeShare = list.filter((h) => h.agree).length / list.length;
    // Per correction: the judge agreeing with code adds the bonus; a disagreement
    // caps that correction at 0.5. The finding takes the mean.
    const start = C.base + C.per_hit * Math.max(0, eps.length - bar);
    const each = list.map((h) => Math.min(h.agree ? start + C.agree_bonus : Math.min(start, C.disagree_cap), C.candidates_max));
    let value = each.reduce((n, v) => n + v, 0) / each.length;
    value = Math.round(Math.min(value, C.candidates_max) * 100) / 100;
    const label = value >= t.confidence.label_high ? 'high' : value >= t.confidence.label_medium ? 'medium' : 'low';
    // The highest-cost hit (tokens after the correction) is the episode shown.
    const cost = (h) => h.bundle.meta.tokens_after[h.c.turn_id] ?? 0;
    const top = [...list].sort((a, b) => cost(b) - cost(a) || (a.line.episode_id < b.line.episode_id ? -1 : 1))[0];
    const tokens = list.reduce((n, h) => n + cost(h), 0);
    const humanTurns = list.reduce((n, h) => n + (h.bundle.meta.human_after[h.c.turn_id] ?? 0), 0);
    const sessions = new Set(eps.map((e) => episodes.get(e)?.session_id).filter(Boolean)).size;
    const repos = new Set(eps.map((e) => episodes.get(e)?.repo ?? episodes.get(e)?.stratum?.project).filter(Boolean)).size;
    // Under 15 flagged episodes (every T1 sample), severity is capped at low.
    const sev = usageSeverity({ tokens, episodes: N, flaggedN: eps.length }, t).label;
    const m = { hits: eps.length, judged: N, corrections: list.length, tokens, human_turns: humanTurns, sessions, repos, partial };
    const c = copy.finding(kind, { metric: m });
    const corrT = top.bundle.meta.turn_t[top.c.turn_id];
    const ep = episodes.get(top.line.episode_id);
    const timeline = [
      { t: hhmm(top.bundle.meta.root_t), label_scrubbed: 'Prompt', kind: 'neutral', event_kind: 'Prompt' },
      { t: hhmm(corrT), label_scrubbed: kind === 'late_constraint' ? 'Constraint added' : 'Rule restated', kind: 'warn', event_kind: 'Correction' },
      ...(ep?.terminal === 'commit' || ep?.terminal === 'pr' ? [{ t: hhmm(top.bundle.meta.end), label_scrubbed: 'Commit', kind: 'resolve', event_kind: 'Commit' }] : [{ t: hhmm(top.bundle.meta.end), label_scrubbed: 'Episode end', kind: 'neutral', event_kind: 'End' }]),
    ];
    const gapMin = minutesBetween(top.bundle.meta.root_t, corrT);
    const user = kind === 'late_constraint' ? userPivot(top.bundle, top.c.turn_id, t) : null;
    const evidence = [
      { kind: 'mechanical', locator: 'session history', metric: `${list.length} code-flagged correction ${list.length === 1 ? 'candidate' : 'candidates'} across ${eps.length} judged ${eps.length === 1 ? 'episode' : 'episodes'}` },
      ...list.slice(0, 5).map((h) => ({
        kind: 'judge',
        locator: `${h.line.episode_id} ${h.c.turn_id}`,
        metric: `judge read: supplies a constraint; ${OWNER[h.code].replace('Owner: ', 'owner ').toLowerCase()}${h.agree ? '' : ' (the judge said otherwise)'}`,
        verdict: `supplies a constraint; ${OWNER[h.code].replace('Owner: ', 'owner ').toLowerCase()}${h.agree ? '' : ' (the judge said otherwise)'}`,
        judge_confidence: h.c.attribution.confidence,
        excerpt_scrubbed: h.c.quotes[0]?.text ?? null,
      })),
    ];
    findings.push({
      id,
      kind,
      entry_id: spec.entry_ids[0],
      lens: 'usage',
      tab: label === 'low' ? 'worth_a_look' : 'amplify',
      title: c.title,
      short: c.short,
      lead: c.lead,
      icon: spec.icon,
      provenance: 'judged',
      candidate: true,
      caveat: CANDIDATE_CAVEAT,
      attribution: spec.attribution,
      confidence: { value, label, basis: `${eps.length} of ${N} judged episodes, bar ${bar}; judge agreed on ${Math.round(agreeShare * 100)}% of corrections; accuracy not yet measured` },
      severity: { tokens_attributable: tokens, human_turns_attributable: humanTurns, delay_minutes: null, label: sev },
      recurrence: { hits: eps.length, sample: N, stratum: null, control_rate: null },
      support: { sessions, repos },
      evidence,
      anchor: evidence[0].locator,
      counter_reading: null,
      adversarial: null,
      episode_ref: { episode_id: top.line.episode_id, timeline },
      why: c.why,
      problem: c.problem,
      pivot: user
        ? { kind: generic.kind, action: generic.action, before_scrubbed: user.before, after_scrubbed: user.after, after_marks: user.marks, setup_note: generic.setup_note, source: 'user_prompt', minutes_to_apply: t.minutes_to_apply[generic.kind] }
        : { kind: generic.kind, action: generic.action, before_scrubbed: generic.before, after_scrubbed: generic.after, after_marks: [], setup_note: generic.setup_note, source: 'shrine_generic', minutes_to_apply: t.minutes_to_apply[generic.kind] },
      praise_class: null,
      benefit: c.benefit,
      shrine_refs: refs,
      owner_label: OWNER[spec.attribution],
      timeline_gap: gapMin > 0 ? { from_t: timeline[0].t, to_t: timeline[1].t, label: copy.gapLabel(kind, gapMin) } : null,
      coverage_key: refs[0].page_id.split('/')[1],
      items: eps.slice(0, 10).map((e) => ({ episode: e })),
    });
  }
  const invalid = lines.filter((l) => !l.valid).length;
  return {
    findings,
    dropped,
    attribution_stack: traced ? stack : null,
    summary: {
      planned: order.items.length,
      judged: N,
      calls: lines.reduce((n, l) => n + (l.attempts ?? 1), 0),
      tokens_floor: lines.some((l) => l.tokens?.floor),
      invalid,
      refusals: lines.filter((l) => l.refusal).length,
      outcomes,
      corrections_traced: traced,
      unknown_verdicts: unknownVerdicts,
      bar,
      partial,
      tokens_used: lines.reduce((n, l) => n + (l.tokens?.total ?? 0), 0),
      model_ids: [...new Set(lines.map((l) => l.model_id).filter(Boolean))].sort(),
    },
  };
}

const SEV = { high: 3, medium: 2, low: 1 };

// Adds T1 results to a scored findings.json: judged findings, the attribution
// stack, coverage and headline counts, TLDR, and the judging summary. A judged
// candidate is never the "Start with" pick and never the top-finding fallback
// while a mechanical finding exists.
export function mergeJudged(base, judged, { reviewers = 1, minutes = 0, sample = null, estimate = null } = {}) {
  const out = structuredClone(base);
  const amplifyNew = judged.findings.filter((f) => f.tab === 'amplify');
  const lookNew = judged.findings.filter((f) => f.tab === 'worth_a_look');
  const order = (a, b) => SEV[b.severity.label] - SEV[a.severity.label] || (a.provenance === b.provenance ? 0 : a.provenance === 'mechanical' ? -1 : 1);
  out.findings = [...out.findings, ...amplifyNew].sort(order);
  out.worth_a_look = [...out.worth_a_look, ...lookNew];
  out.dropped = [...out.dropped, ...judged.dropped];
  out.tier = 'T1';
  out.reviewers = reviewers;
  out.minutes_elapsed = minutes;
  out.tokens_used = judged.summary.tokens_used;
  out.attribution_stack = judged.attribution_stack;
  for (const c of out.coverage) {
    const n = amplifyNew.filter((f) => f.coverage_key === c.key).length;
    if (n) {
      c.amplify += n;
      c.checked = true;
    }
  }
  const amplify = out.findings.filter((f) => f.tab === 'amplify');
  const working = out.findings.filter((f) => f.tab === 'working');
  out.headline.counts = { ...out.headline.counts, amplify: amplify.length, worth_a_look: out.worth_a_look.length, judged_episodes: judged.summary.judged, corrections_traced: judged.summary.corrections_traced };
  out.headline.tldr = [...amplify.slice(0, 2), ...(working[0] ? [working[0]] : amplify.slice(2, 3))].map((f) => ({
    status: f.tab === 'working' ? 'working' : 'amplify',
    headline: f.title,
    sentence: f.lead.split(/(?<=\.)\s/)[0],
    finding_id: f.id,
  }));
  const sw = out.headline.start_with;
  if (!sw || out.findings.find((f) => f.id === sw.finding_id)?.candidate) {
    const pick = amplify.find((f) => !f.candidate);
    out.headline.start_with = pick ? { finding_id: pick.id, action: pick.pivot.action, minutes_to_apply: pick.pivot.minutes_to_apply, framed: false } : null;
  }
  out.judging = { ...judged.summary, sample: sample ? { seed: sample.seed, size: sample.size, eligible: sample.eligible, total_episodes: sample.total_episodes, thin: sample.thin, small_history: sample.small_history, cap_relaxed: sample.cap_relaxed } : null, estimate };
  return out;
}
