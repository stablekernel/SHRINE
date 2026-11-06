// T0 statistics (spec 4, plan T2.9). A printed rate difference with N for both
// groups; no intervals at T0 (bootstrap arrives at T2 and up). Small flagged
// groups cap severity at low. History-size rules decide what a run may claim.

// control: rateDifference() output. Returns the control verdict.
export function controlTest(control, { minN, points }) {
  if (!control) return { status: 'none', beats: false, diff_points: null };
  // No flagged episode with linked commits: nothing to compare, whatever the rest shows.
  if (!control.flagged.n) return { status: 'no_flagged_baseline', beats: false, diff_points: null };
  if (control.rest.n < minN) return { status: 'no_control_baseline', beats: false, diff_points: control.diff_points };
  return { status: 'ok', beats: control.diff_points >= points, diff_points: control.diff_points };
}

const label = (v, c) => (v >= c.label_high ? 'high' : v >= c.label_medium ? 'medium' : 'low');

// 0.6 + 0.05 per hit above the bar + 0.1 when beating control, max 0.85;
// "candidates" kinds are capped below the high label.
export function usageConfidence({ hitsAboveBar, beatsControl, candidates }, t) {
  const c = t.usage.confidence;
  let v = c.base + c.per_hit * Math.max(0, hitsAboveBar) + (beatsControl ? c.control_bonus : 0);
  v = Math.min(v, c.max);
  if (candidates) v = Math.min(v, c.candidates_max);
  v = Math.round(v * 100) / 100;
  return { value: v, label: label(v, t.confidence) };
}

// Bands are provisional: attributable tokens per 10 episodes.
export function usageSeverity({ tokens, episodes, flaggedN }, t) {
  const b = t.usage.severity_tokens_per_10_episodes;
  const per10 = episodes ? (tokens / episodes) * 10 : 0;
  const band = per10 >= b.high ? 'high' : per10 >= b.medium ? 'medium' : 'low';
  const capped = flaggedN < t.usage.small_n_episodes;
  return { label: capped ? 'low' : band, per_10_episodes: Math.round(per10), capped };
}

// In order, first match wins: no history or zero sessions; under 10 sessions;
// otherwise probe-based (tier proposal capped at T0 in this version).
export function historyRule({ consented, sessions }, t) {
  if (!consented || !sessions) return 'setup_only';
  if (sessions < t.history.limited_sessions) return 'limited';
  return 'probe';
}

export const tierProposal = () => 'T0';
