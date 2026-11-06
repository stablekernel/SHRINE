// Scorer, config lens (spec 5). Turns probe results into findings.json: evidence
// bar, confidence, severity, tab, coverage, TLDR, start_with, checked_clear.
// Re-runnable from stored inputs; no IO.
import { createHash } from 'node:crypto';
import { scrubSecrets } from '../scrub/secrets.mjs';
import { underHome } from '../scrub/mask.mjs';
import { THRESHOLDS } from '../probes/config.mjs';
import { controlTest, usageConfidence, usageSeverity } from './stats.mjs';

export const TOOL_VERSION = '0.1.1';
const SEV_RANK = { high: 3, medium: 2, low: 1 };
const KIND_ORDER = ['blanket_permissions', 'stale_instructions', 'oversized_instructions', 'done_without_test', 'no_owner_or_review', 'stack_gap', 'short_retention'];

// Coverage areas: 7 ratified principles (North Star excluded; it frames cost) in
// the docs' deliberate order, then every pattern page, then every stack page. The
// report shows only areas with a finding, grouped by `group`.
export const COVERAGE = [
  ['authority-cascade', 'layers'],
  ['human-in-the-loop', 'hand'],
  ['problem-before-prescription', 'compass'],
  ['consistency-as-leverage', 'grid'],
  ['fail-fast-recover-smart', 'loop'],
  ['reproducibility', 'repeat'],
  ['deliberate-currency', 'clock'],
];

export function findingId(kind, entryId, itemKey) {
  return `f-${createHash('sha256').update(`${kind}|${entryId}|${itemKey}`).digest('hex').slice(0, 12)}`;
}

export function displayPath(path, home) {
  if (typeof path !== 'string') return path;
  const rest = underHome(path, home);
  const p = rest != null ? `~${rest}` : path;
  return scrubSecrets(p);
}

function ref(catalogue, entryId) {
  const e = catalogue.entries[entryId];
  if (!e) return null;
  return { entry_id: e.entry_id, page_id: e.page_id, anchor: e.anchor, title: e.title, section: e.section, status: e.status, url: e.url, url_pinned: e.url_pinned, quote: e.quote };
}

// A principle ref wins (key is its slug); else the first pattern or stack page.
function coverageKey(refs) {
  const p = refs.find((r) => r.section === 'principle' && r.page_id !== 'principles/tokens-to-value');
  if (p) return p.page_id.split('/')[1];
  const other = refs.find((r) => r.section === 'pattern' || r.section === 'stack');
  return other ? other.page_id : 'unmapped';
}

const AREA_GROUPS = [
  ['patterns', 'book'],
  ['stack', 'wrench'],
];

export function coverageAreas(catalogue) {
  const title = (id) => catalogue.principles.find((p) => p.id === `principles/${id}`)?.title ?? id;
  return [
    ...COVERAGE.map(([key, icon]) => ({ key, title: title(key), icon, group: 'principles' })),
    ...AREA_GROUPS.flatMap(([group, icon]) =>
      (catalogue[group] ?? []).filter((p) => !p.id.endsWith('/overview')).map((p) => ({ key: p.id, title: p.title, icon, group })),
    ),
  ];
}

function evidenceOf(p, home) {
  const items = p.items.length ? p.items : [{ locator: 'setup' }];
  return items.slice(0, 10).map((i) => {
    const locator = displayPath(i.path ?? i.rule ?? i.locator ?? i.missing ?? 'setup', home);
    const metric =
      i.age_days != null ? `${i.age_days} days since last change`
        : i.bytes != null ? `${Math.round(i.bytes / 1024)} KB`
          : i.missing && Array.isArray(i.missing) ? `missing ${i.missing.join(' and ')}`
            : i.missing ? `no ${i.missing}`
              : i.reason ? `${i.rule}: ${i.reason}`
                : null;
    return { kind: 'mechanical', locator, metric };
  });
}

// Usage lens (T0): a kind becomes a finding only when thresholds ship it as
// "candidates", it hit, and history is past the thin-window rule. Otherwise it
// stays an appendix count. Attribution is "Could not tell" at T0.
function usageFindings({ usage, catalogue, pivots, copy, t, kindsMap }) {
  const out = [];
  const dropped = [];
  for (const k of usage.kinds) {
    if (k.ship !== 'candidates' || !k.hit || usage.rule !== 'probe') continue;
    const ids = kindsMap[k.kind]?.entry_ids ?? [];
    const refs = ids.map((e) => ref(catalogue, e)).filter(Boolean);
    const pivot = pivots[ids[0]];
    const id = findingId(k.kind, ids[0], 'usage');
    if (!refs.length || !pivot) {
      dropped.push({ id, reason: `no catalogue entry or pivot for ${k.kind}` });
      continue;
    }
    const ctl = controlTest(k.control, { minN: t.usage.control_min_episodes, points: t.usage[k.kind].control_points });
    const bar = Math.floor(k.metric.threshold * k.metric.claims);
    const conf = usageConfidence({ hitsAboveBar: k.metric.flagged - bar, beatsControl: ctl.beats, candidates: true }, t);
    const sev = usageSeverity({ tokens: k.tokens, episodes: k.metric.flagged, flaggedN: k.metric.flagged }, t);
    const c = copy.finding(k.kind, k);
    const evidence = [
      { kind: 'mechanical', locator: 'session history', metric: `${k.metric.flagged} of ${k.metric.claims} done claims had no prior test or check` },
      { kind: 'mechanical', locator: 'control', metric: k.control && ctl.status === 'ok' ? `rework within ${t.history.link_hours} hours: ${Math.round(k.control.flagged.rate * 100)}% of ${k.control.flagged.n} flagged episodes, ${Math.round(k.control.rest.rate * 100)}% of ${k.control.rest.n} other episodes` : 'no control baseline' },
    ];
    // A rate over a sample one project dominates says so next to the rate.
    const dom = copy.dominanceLine?.(usage.counts);
    if (dom) evidence.push({ kind: 'mechanical', locator: 'sample', metric: dom });
    out.push({
      id,
      kind: k.kind,
      entry_id: ids[0],
      lens: 'usage',
      tab: 'amplify',
      title: c.title,
      short: c.short,
      lead: c.lead,
      icon: c.icon,
      provenance: 'mechanical',
      attribution: 'unknown',
      confidence: { ...conf, basis: `pattern candidates; control ${ctl.status === 'ok' ? `difference ${ctl.diff_points} points` : 'not available'}` },
      severity: { tokens_attributable: k.tokens, human_turns_attributable: null, delay_minutes: null, label: sev.label },
      recurrence: { hits: k.metric.flagged, sample: k.metric.claims, stratum: null, control_rate: k.control?.rest.rate ?? null },
      evidence,
      anchor: evidence[0].locator,
      counter_reading: null,
      adversarial: null,
      episode_ref: k.episode_ref ?? null,
      why: c.why,
      problem: c.problem,
      pivot: { kind: pivot.kind, action: pivot.action, before_scrubbed: pivot.before, after_scrubbed: pivot.after, after_marks: [], setup_note: pivot.setup_note, source: 'shrine_generic', minutes_to_apply: t.minutes_to_apply[pivot.kind] },
      praise_class: null,
      benefit: c.benefit,
      shrine_refs: refs,
      owner_label: 'Owner: Could not tell',
      timeline_gap: null,
      coverage_key: coverageKey(refs),
      items: k.episode_ids.slice(0, 10).map((e) => ({ episode: e })),
      config_strip: null,
    });
  }
  return { out, dropped };
}

const usageThresholds = (t) => ({
  done_claims_without_test_pct: Math.round(t.usage.done_without_test.rate * 100),
  retries_per_100_tool_calls: t.usage.retry_loops.per_100,
  control_min_episodes: t.usage.control_min_episodes,
  limited_history_sessions: t.history.limited_sessions,
  one_project_warning_pct: Math.round(t.usage.dominant_project_share * 100),
  idle_cut_minutes: t.history.idle_minutes,
  rework_link_hours: t.history.link_hours,
});

// Sessions started on or after the config's last change, where that config was
// live: a project's auto-memory folder counts that project's sessions; a
// user-global file counts all; any other file counts the project that holds it
// plus the projects whose always-loaded chain imports it. null when history was
// not read, the change date is unknown, or no project is known to load the file.
// sessions: [{start, root}]; scopes: [{root, memory_dirs: [one per session cwd], loaded: [paths]}];
// userLoaded: paths every session loads (the user chain and its imports).
function sessionsSince(item, sessions, scopes, home, userLoaded) {
  if (!sessions || !item.date) return null;
  const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
  const memory = scopes.find((s) => (s.memory_dirs ?? []).some((d) => under(item.path, d)));
  let roots = null;
  if (memory) roots = new Set([memory.root]);
  else if (userLoaded.includes(item.path) || (home && (under(item.path, `${home}/.claude`) || item.path === `${home}/.claude.json`))) roots = null;
  else {
    const holder = scopes.map((s) => s.root).filter((r) => under(item.path, r)).sort((a, b) => b.length - a.length)[0];
    roots = new Set([holder, ...scopes.filter((s) => (s.loaded ?? []).includes(item.path)).map((s) => s.root)].filter(Boolean));
    if (!roots.size) return null;
  }
  // Compare instants: git %cI carries a local offset, session starts are UTC.
  const since = Date.parse(item.date);
  if (Number.isNaN(since)) return null;
  return sessions.filter((s) => Date.parse(s.start) >= since && (!roots || roots.has(s.root))).length;
}

export function score({ run, shrine, probes, structure, catalogue, pivots, copy, inventoryCounts = {}, home = null, history = { consented: false, read: false, sessions: null }, usage = null, usageKinds = {}, sessionStarts = null, projectScopes = [], userLoaded = [], thresholds = THRESHOLDS, tier = 'T0' }) {
  const t = thresholds;
  const findings = [];
  const dropped = [];
  const checked_clear = [];
  if (usage) {
    const u = usageFindings({ usage, catalogue, pivots, copy, t, kindsMap: usageKinds });
    findings.push(...u.out);
    dropped.push(...u.dropped);
  }

  // A probe without applicable: false ran; older callers omit the field.
  const ran = probes.filter((p) => p.applicable !== false);
  for (const p of probes) {
    const id = findingId(p.kind, p.entry_id, 'setup');
    const r = p.entry_id ? ref(catalogue, p.entry_id) : null;
    if (!p.hit) {
      if (r && p.applicable !== false) checked_clear.push({ id, ...copy.clear(p.kind, p), entry_id: p.entry_id, title: r.title, shrine_ref: r });
      continue;
    }
    if (!p.entry_id || !r) {
      dropped.push({ id, reason: p.entry_id ? `entry_id ${p.entry_id} not in catalogue` : 'no entry_id' });
      continue;
    }
    const refs = [r, ...(p.see_also ?? []).map((e) => ref(catalogue, e)).filter(Boolean)];
    const pivot = pivots[p.entry_id];
    const label = t.severity.config[p.kind] ?? t.severity.config.default;
    const c = copy.finding(p.kind, p);
    const evidence = evidenceOf(p, home);
    const first = p.items.find((i) => i.path);
    findings.push({
      id,
      kind: p.kind,
      entry_id: p.entry_id,
      lens: 'config',
      tab: 'amplify',
      title: c.title,
      short: c.short,
      lead: c.lead,
      icon: c.icon,
      provenance: 'mechanical',
      attribution: 'harness',
      confidence: { value: t.confidence.config, label: t.confidence.config >= t.confidence.label_high ? 'high' : 'medium', basis: 'deterministic fact from your setup files' },
      severity: { tokens_attributable: null, human_turns_attributable: null, delay_minutes: null, label },
      recurrence: { hits: null, sample: null, stratum: null, control_rate: null },
      evidence,
      anchor: evidence[0].locator,
      counter_reading: null,
      adversarial: null,
      episode_ref: null,
      why: c.why,
      problem: c.problem,
      pivot: {
        kind: pivot.kind,
        action: pivot.action,
        before_scrubbed: pivot.before,
        after_scrubbed: pivot.after,
        after_marks: [],
        setup_note: pivot.setup_note,
        source: 'shrine_generic',
        minutes_to_apply: t.minutes_to_apply[pivot.kind],
      },
      praise_class: null,
      benefit: c.benefit,
      shrine_refs: refs,
      owner_label: 'Owner: Setup',
      timeline_gap: null,
      coverage_key: coverageKey(refs),
      items: p.items.map((i) => (i.path ? { ...i, path: displayPath(i.path, home) } : i)),
      config_strip: first ? { mtime: first.date ?? null, last_git_change: first.date_source === 'git' ? first.date : null, sessions_since: sessionsSince(first, sessionStarts, projectScopes, home, userLoaded) } : null,
    });
  }

  // A structure check that ran and failed counts only when a finding cites its
  // entry; otherwise it is neither clear nor a finding, and is reported apart.
  const cited = new Set(findings.flatMap((f) => f.shrine_refs.map((r) => r.entry_id)));
  const counted = structure.filter((s) => s.applicable && (s.pass || cited.has(s.entry_id)));
  const failedUncited = structure.filter((s) => s.applicable && !s.pass && !cited.has(s.entry_id));
  const notPassed = failedUncited.length;

  for (const s of structure) {
    if (!s.applicable || !s.pass) continue;
    const r = ref(catalogue, s.entry_id);
    if (!r) continue;
    checked_clear.push({ id: findingId(`structure:${s.check}`, s.entry_id, 'setup'), ...copy.clear(s.check, s), entry_id: s.entry_id, title: r.title, shrine_ref: r });
  }

  findings.sort((a, b) => SEV_RANK[b.severity.label] - SEV_RANK[a.severity.label] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const amplify = findings.filter((f) => f.tab === 'amplify');
  const working = findings.filter((f) => f.tab === 'working');

  const tldr = [...amplify.slice(0, 2), ...(working[0] ? [working[0]] : amplify.slice(2, 3))].map((f) => ({
    status: f.tab === 'working' ? 'working' : 'amplify',
    headline: f.title,
    sentence: f.lead.split(/(?<=\.)\s/)[0],
    finding_id: f.id,
  }));
  const eligible = amplify.find((f) => f.confidence.label === 'high' && f.pivot.minutes_to_apply <= t.start_with_max_minutes);
  const pick = eligible ?? amplify[0];
  const start_with = pick ? { finding_id: pick.id, action: pick.pivot.action, minutes_to_apply: pick.pivot.minutes_to_apply, framed: Boolean(eligible) } : null;

  // An area is checked when some check that ran at this tier maps to it (passed,
  // failed, or failed with no finding kind yet), or when it holds a finding from
  // any source. A failed check with no finding marks its area not_passed, so the
  // area is never counted as showing no findings.
  const checkRefs = (ids) => ids.map((e) => ref(catalogue, e)).filter(Boolean);
  const checkedKeys = new Set([
    ...[
      ...ran.map((p) => checkRefs([p.entry_id, ...(p.see_also ?? [])])),
      ...counted.map((s) => checkRefs([s.entry_id])),
      ...failedUncited.map((s) => checkRefs([s.entry_id])),
    ].filter((refs) => refs.length).map(coverageKey),
    ...findings.map((f) => f.coverage_key),
  ]);
  const notPassedKeys = failedUncited.map((s) => checkRefs([s.entry_id])).filter((refs) => refs.length).map(coverageKey);
  const coverage = coverageAreas(catalogue).map(
    (c) => ({
      ...c,
      checked: checkedKeys.has(c.key),
      working: working.filter((f) => f.coverage_key === c.key).length,
      amplify: amplify.filter((f) => f.coverage_key === c.key).length,
      not_passed: notPassedKeys.filter((k) => k === c.key).length,
    }),
  );

  const configured = Object.entries(inventoryCounts)
    .filter(([, n]) => n > 0)
    .map(([item, count]) => ({ item, count }));

  return {
    schema_version: 1,
    run,
    shrine,
    tier,
    reviewers: 0,
    minutes_elapsed: 0,
    tokens_used: 0,
    headline: {
      counts: {
        amplify: amplify.length,
        working: working.length,
        worth_a_look: 0,
        checked_clear: checked_clear.length,
        configured: configured.length,
        checks: ran.length + counted.length,
        not_passed: notPassed,
        ...(usage ? { sessions: usage.counts.sessions, correction_candidates: usage.counts.correction_candidates } : {}),
      },
      tldr,
      start_with,
    },
    coverage,
    attribution_stack: null,
    findings,
    worth_a_look: [],
    checked_clear,
    dropped,
    configured,
    control_slice: null,
    unknowable: copy.unknowable(),
    skipped_files: [],
    integrity: { ok: true, changed_paths: [] },
    notes: !history.consented ? ['history not read'] : usage?.rule === 'limited' ? [copy.notes.limited] : !usage ? [copy.notes.none] : [],
    thresholds: { version: t.version, ...t.config, ...(usage ? usageThresholds(t) : {}) },
    history,
    ...(usage ? { usage: { counts: usage.counts, kinds: usage.kinds.map(({ kind, ship, applicable, hit, metric, control }) => ({ kind, ship, applicable, hit, metric, control })), automation: usage.automation, limited: usage.rule === 'limited', excluded_own: Boolean(usage.excluded_own), lines: copy.usageLines({ ...usage, limited: usage.rule === 'limited' }) } } : {}),
  };
}
