// A deterministic T0 findings.json (bad setup, no history) for render and visual
// tests, built through the real scorer and copywriter.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { score } from '../../src/scorer/score.mjs';
import { copy } from '../../src/copy/templates.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

export function t0BadSetupFindings() {
  const catalogue = load('../../src/catalogue/catalogue.json');
  const pivots = load('../../src/catalogue/generic-pivots.json');
  const K = load('../../src/catalogue/t0-kinds.json');
  const home = '/home/fixture';
  const probes = [
    { kind: 'stale_instructions', hit: true, items: [{ path: `${home}/.claude/CLAUDE.md`, age_days: 658, date: '2025-01-15T09:00:00.000Z', date_source: 'mtime' }, { path: '/work/bad-project/CLAUDE.md', age_days: 658, date: '2025-01-15T09:00:00.000Z', date_source: 'git' }], metric: { count: 2, total: 2, max_age_days: 658, threshold_days: 180 } },
    { kind: 'oversized_instructions', hit: true, items: [{ path: `${home}/.claude/CLAUDE.md`, bytes: 45056 }], metric: { bytes: 45120, kb: 44, threshold_kb: 40, project: '/work/bad-project' } },
    { kind: 'no_owner_or_review', hit: true, items: [{ path: `${home}/.claude/CLAUDE.md`, missing: ['owner', 'review date'] }, { path: '/work/bad-project/CLAUDE.md', missing: ['owner', 'review date'] }], metric: { count: 2, total: 2 } },
    { kind: 'blanket_permissions', hit: true, items: [{ path: `${home}/.claude/settings.json`, rule: 'Bash', reason: 'blanket shell allow' }, { path: `${home}/.claude/settings.json`, rule: 'Write', reason: 'blanket write allow' }, { path: `${home}/.claude/settings.json`, rule: 'defaultMode: bypassPermissions', reason: 'bypass or auto-approve default mode' }], metric: { count: 3, rules: 2, settings: 1 } },
    { kind: 'stack_gap', hit: true, items: [{ missing: 'hooks' }, { missing: 'skills' }, { missing: 'memory' }], metric: { hooks: 0, skills: 0, memory: 0, missing: ['hooks', 'skills', 'memory'] } },
    { kind: 'short_retention', hit: true, items: [], metric: { days: 30, source: 'default', threshold_days: 30 } },
  ].map((p) => ({ ...p, entry_id: K.kinds[p.kind].entry_ids[0], see_also: K.kinds[p.kind].entry_ids.slice(1) }));
  const structure = Object.keys(K.structure).map((check) => ({ check, entry_id: K.structure[check].entry_ids[0], applicable: check !== 'repo_layout', pass: check === 'instruction_layers', items: [] }));
  return score({
    run: {
      id: 't0-visual',
      started_at: '2026-11-04T12:00:00.000Z',
      tool_version: '0.1.0',
      harness: { name: 'Claude Code', version: null },
      scope: { projects: ['bad-project'], from: null, to: null, history_consented: false },
      win_definition: null,
      seed: null,
    },
    shrine: { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null },
    probes,
    structure,
    catalogue,
    pivots,
    copy,
    inventoryCounts: { 'instruction files': 2 },
    home,
  });
}
