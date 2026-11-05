// Scorer, config lens (spec 5). Turns probe results into findings.json: evidence
// bar, confidence, severity, tab, coverage, TLDR, start_with, checked_clear.
// Re-runnable from stored inputs; no IO.
import { createHash } from 'node:crypto';
import { scrubSecrets } from '../scrub/secrets.mjs';
import { underHome } from '../scrub/mask.mjs';
import { THRESHOLDS } from '../probes/config.mjs';

export const TOOL_VERSION = '0.1.0';
const SEV_RANK = { high: 3, medium: 2, low: 1 };
const KIND_ORDER = ['blanket_permissions', 'stale_instructions', 'oversized_instructions', 'no_owner_or_review', 'stack_gap', 'short_retention'];

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

export function score({ run, shrine, probes, structure, catalogue, pivots, copy, inventoryCounts = {}, home = null, history = { consented: false, read: false, sessions: null }, thresholds = THRESHOLDS, tier = 'T0' }) {
  const t = thresholds;
  const findings = [];
  const dropped = [];
  const checked_clear = [];

  for (const p of probes) {
    const id = findingId(p.kind, p.entry_id, 'setup');
    const r = p.entry_id ? ref(catalogue, p.entry_id) : null;
    if (!p.hit) {
      if (r) checked_clear.push({ id, ...copy.clear(p.kind, p), entry_id: p.entry_id, title: r.title, shrine_ref: r });
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
      config_strip: first ? { mtime: first.date ?? null, last_git_change: first.date_source === 'git' ? first.date : null, sessions_since: history.sessions } : null,
    });
  }

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

  const coverage = coverageAreas(catalogue).map(
    (c) => ({
      ...c,
      working: working.filter((f) => f.coverage_key === c.key).length,
      amplify: amplify.filter((f) => f.coverage_key === c.key).length,
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
      counts: { amplify: amplify.length, working: working.length, worth_a_look: 0, checked_clear: checked_clear.length, configured: configured.length, checks: probes.length + structure.filter((s) => s.applicable).length },
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
    notes: history.consented ? [] : ['history not read'],
    thresholds: { version: t.version, ...t.config },
    history,
  };
}
