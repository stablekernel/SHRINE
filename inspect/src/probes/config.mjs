// T0 config probes (spec 4): 6 kinds plus 4 structure checks. Pure functions over
// a collected setup; thresholds and pattern lists are versioned JSON.
import { fileURLToPath } from 'node:url';
import { readJson } from '../io/fsread.mjs';

const load = (rel) => readJson(fileURLToPath(new URL(rel, import.meta.url)));
export const THRESHOLDS = load('../scorer/thresholds.json');
export const KINDS = load('../catalogue/t0-kinds.json');
const OWNER = load('./patterns/owner-line.json');

const DAY = 86400000;
const entry = (kind) => KINDS.kinds[kind].entry_ids[0];
const structureEntry = (check) => KINDS.structure[check].entry_ids[0];
// Further entries a kind cites after its primary one (for example the principle a
// stack anti-pattern serves, so coverage still counts it).
const seeAlso = (kind) => KINDS.kinds[kind].entry_ids.slice(1);

export function ownerLine(text) {
  const lines = (text ?? '').split('\n');
  const has = (res) => lines.some((l) => res.some((r) => new RegExp(r, 'i').test(l)));
  let reviewed = null;
  for (const l of lines) {
    for (const r of OWNER.reviewed) {
      const m = l.match(new RegExp(r, 'i'));
      if (m) reviewed = m[1];
    }
    if (reviewed) break;
  }
  return { owner: has(OWNER.owner), reviewed };
}

const instructionFiles = (s) => s.items.filter((i) => i.kind === 'instruction' && i.loaded_by !== 'output-style');
const ageDays = (iso, now) => Math.floor((now - Date.parse(iso)) / DAY);

function stale(s, t) {
  const files = s.items.filter((i) => (i.kind === 'instruction' || i.kind === 'memory') && i.last_change?.date);
  const items = files
    .map((i) => ({ path: i.path, age_days: ageDays(i.last_change.date, s.now), date: i.last_change.date, date_source: i.last_change.source }))
    .filter((i) => i.age_days > t.config.stale_days)
    .sort((a, b) => b.age_days - a.age_days);
  return {
    applicable: files.length > 0,
    hit: items.length > 0,
    items,
    metric: { count: items.length, total: files.length, max_age_days: items[0]?.age_days ?? 0, threshold_days: t.config.stale_days },
  };
}

function oversized(s, t) {
  const al = s.always_loaded;
  const top = [...(al.by_project ?? [])].sort((a, b) => b.bytes - a.bytes)[0];
  const files = top?.files ?? [];
  return {
    applicable: al.max_bytes > 0,
    hit: al.max_bytes > t.config.oversized_bytes,
    items: [...files].sort((a, b) => b.bytes - a.bytes).map((f) => ({ path: f.path, bytes: f.bytes })),
    metric: { bytes: al.max_bytes, kb: Math.round(al.max_bytes / 1024), threshold_kb: Math.floor(t.config.oversized_bytes / 1024), project: top?.project ?? null },
  };
}

function noOwner(s) {
  const files = instructionFiles(s);
  const items = files
    .map((i) => {
      const o = ownerLine(i.text);
      const missing = [...(o.owner ? [] : ['owner']), ...(o.reviewed ? [] : ['review date'])];
      return { path: i.path, missing };
    })
    .filter((i) => i.missing.length > 0);
  return { applicable: files.length > 0, hit: items.length > 0, items, metric: { count: items.length, total: files.length } };
}

function parseRule(rule) {
  const m = String(rule).match(/^([A-Za-z]+)(?:\((.*)\))?$/);
  return m ? { tool: m[1], scope: (m[2] ?? '').trim() } : { tool: rule, scope: null };
}

function blanket(s, t) {
  const b = t.blanket;
  const items = [];
  for (const a of s.permissions.allow ?? []) {
    const { tool, scope } = parseRule(a.rule);
    if (scope === null) continue;
    const isBlanket = b.blanket_scopes.includes(scope);
    if (b.shell_tools.includes(tool) && isBlanket) items.push({ path: a.path, rule: a.rule, reason: 'blanket shell allow' });
    else if (b.write_tools.includes(tool) && isBlanket) items.push({ path: a.path, rule: a.rule, reason: 'blanket write allow' });
  }
  const mode = s.permissions.defaultMode;
  if (mode && b.modes.includes(mode.value)) items.push({ path: mode.path, rule: `defaultMode: ${mode.value}`, reason: 'bypass or auto-approve default mode' });
  const skip = s.permissions.skipDangerousModePermissionPrompt;
  if (skip?.value === true) items.push({ path: skip.path, rule: 'skipDangerousModePermissionPrompt: true', reason: 'dangerous-mode prompt skipped' });
  // With no readable settings file there are no permissions to judge: not run,
  // never reported clear. A plugin hooks.json carries no permissions.
  const files = s.items.filter((i) => i.kind === 'settings' && i.source !== 'plugin' && !i.parse_error);
  return { applicable: files.length > 0 || items.length > 0, hit: items.length > 0, items, metric: { count: items.length } };
}

function stackGap(s) {
  const counts = {
    hooks: s.items.filter((i) => i.kind === 'hook').length,
    skills: s.items.filter((i) => i.kind === 'skill').length,
    memory: s.items.filter((i) => i.kind === 'memory').length,
  };
  const missing = Object.entries(counts)
    .filter(([, n]) => n === 0)
    .map(([k]) => k);
  return { hit: missing.length > 0, items: missing.map((m) => ({ missing: m })), metric: { ...counts, missing } };
}

function shortRetention(s, t) {
  const days = s.retention.days;
  return { hit: days <= t.config.short_retention_days, items: [], metric: { days, source: s.retention.source, threshold_days: t.config.short_retention_days } };
}

const normLine = (l) => l.replace(/^[\s>*#-]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

function layersCheck(s, t) {
  const files = instructionFiles(s);
  const byLayer = new Map();
  for (const f of files) {
    const set = byLayer.get(f.layer) ?? new Map();
    for (const raw of (f.text ?? '').split('\n')) {
      const n = normLine(raw);
      if (n.length < t.config.duplicate_line_min_chars || ownerLine(raw).owner || ownerLine(raw).reviewed) continue;
      if (!set.has(n)) set.set(n, f.path);
    }
    byLayer.set(f.layer, set);
  }
  const seen = new Map();
  const dupes = [];
  for (const [layer, lines] of byLayer) {
    for (const [line, path] of lines) {
      if (seen.has(line) && seen.get(line).layer !== layer) dupes.push({ line, paths: [seen.get(line).path, path] });
      else seen.set(line, { layer, path });
    }
  }
  return { applicable: byLayer.size >= 2, pass: dupes.length === 0, items: dupes.slice(0, 20) };
}

function layoutCheck(s) {
  const repos = s.repos ?? [];
  const key = (r) => [...new Set(r.layout)].sort().join('|');
  const groups = new Set(repos.map(key));
  // Repos with no layout files at all agree vacuously: nothing to compare.
  return { applicable: repos.length >= 2 && repos.some((r) => r.layout.length > 0), pass: groups.size <= 1, items: repos.map((r) => ({ root: r.root, layout: [...new Set(r.layout)].sort() })) };
}

function reviewedCheck(s, t) {
  const files = instructionFiles(s);
  const items = files.map((f) => {
    const { reviewed } = ownerLine(f.text);
    const date = reviewed ?? (f.last_change?.source === 'git' ? f.last_change.date : null);
    const age = date ? ageDays(date, s.now) : null;
    return { path: f.path, date, source: reviewed ? 'review line' : date ? 'git' : 'none', ok: age !== null && age <= t.config.review_days };
  });
  return { applicable: files.length > 0, pass: items.every((i) => i.ok), items: items.filter((i) => !i.ok) };
}

export function runConfigProbes(setup, t = THRESHOLDS) {
  const raw = {
    stale_instructions: stale(setup, t),
    oversized_instructions: oversized(setup, t),
    no_owner_or_review: noOwner(setup),
    blanket_permissions: blanket(setup, t),
    stack_gap: stackGap(setup),
    short_retention: shortRetention(setup, t),
  };
  // A probe with nothing to look at (no instruction, memory, or settings files) did not run:
  // it is never reported clear and never marks its area checked.
  const probes = Object.entries(raw).map(([kind, r]) => ({ kind, entry_id: entry(kind), see_also: seeAlso(kind), applicable: r.applicable ?? true, hit: r.hit, items: r.items, metric: r.metric }));
  const checks = {
    instruction_layers: layersCheck(setup, t),
    repo_layout: layoutCheck(setup),
    permissions_scoped: { applicable: raw.blanket_permissions.applicable, pass: !raw.blanket_permissions.hit, items: raw.blanket_permissions.items },
    instructions_reviewed: reviewedCheck(setup, t),
  };
  const structure = Object.entries(checks).map(([check, r]) => ({ check, entry_id: structureEntry(check), applicable: r.applicable, pass: r.pass, items: r.items }));
  return { probes, structure };
}
