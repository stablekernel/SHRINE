import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConfigProbes, ownerLine } from '../../src/probes/config.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const instr = (path, { text = 'Owner: me\nReviewed: 2026-10-20\n- rule one here', age = 10, src = 'git', layer = 'user' } = {}) => ({
  path,
  kind: 'instruction',
  layer,
  source: layer,
  loaded_by: 'always',
  bytes: text.length,
  mtime: daysAgo(age),
  text,
  last_change: { date: daysAgo(age), source: src },
});

function setup(over = {}) {
  return {
    now: NOW,
    items: [
      instr('/h/.claude/CLAUDE.md'),
      instr('/r/a/CLAUDE.md', { layer: 'project', text: 'Owner: team\nReviewed: 2026-10-01\n- project rule' }),
      { path: '/h/.claude/settings.json', kind: 'settings', source: 'user', layer: 'user', loaded_by: 'harness' },
      { path: '/h/.claude/settings.json#hooks.PostToolUse[0]', kind: 'hook', source: 'user', layer: 'user', loaded_by: 'settings' },
      { path: '/h/.claude/skills/x/SKILL.md', kind: 'skill', source: 'user', layer: 'user', loaded_by: 'on-demand' },
      { path: '/h/.claude/projects/-r-a/memory/MEMORY.md', kind: 'memory', source: 'user', layer: 'user', loaded_by: 'auto-memory', text: 'x', last_change: { date: daysAgo(3), source: 'mtime' }, mtime: daysAgo(3) },
    ],
    permissions: { allow: [{ rule: 'Bash(npm test:*)', path: '/h/.claude/settings.json' }], ask: [], deny: [], defaultMode: { value: 'default' }, skipDangerousModePermissionPrompt: null },
    always_loaded: { max_bytes: 2000, by_project: [{ project: '/r/a', bytes: 2000, files: [{ path: '/h/.claude/CLAUDE.md', bytes: 2000 }] }] },
    retention: { days: 90, source: 'settings' },
    repos: [
      { root: '/r/a', layout: ['CLAUDE.md', '.claude/settings.json'] },
      { root: '/r/b', layout: ['CLAUDE.md', '.claude/settings.json'] },
    ],
    ...over,
  };
}

const probe = (s, kind) => runConfigProbes(s).probes.find((p) => p.kind === kind);
const check = (s, name) => runConfigProbes(s).structure.find((c) => c.check === name);

test('every probe returns kind, entry_id, see_also, applicable, hit, items, metric', () => {
  const { probes } = runConfigProbes(setup());
  assert.equal(probes.length, 6);
  for (const p of probes) {
    assert.deepEqual(Object.keys(p).sort(), ['applicable', 'entry_id', 'hit', 'items', 'kind', 'metric', 'see_also']);
    assert.ok(p.entry_id);
    assert.ok(Array.isArray(p.see_also));
  }
  assert.ok(probes.every((p) => p.hit === false), 'clean setup raises nothing');
});

test('blanket_permissions cites the approval-step anti-pattern first, Human in the Loop second', () => {
  const p = runConfigProbes(setup()).probes.find((x) => x.kind === 'blanket_permissions');
  assert.equal(p.entry_id, 'tool-integration.ap.no-approval-step');
  assert.deepEqual(p.see_also, ['human-in-the-loop.sov.undefined-boundary']);
});

test('stale_instructions: pass and fail, git date first, mtime fallback', () => {
  assert.equal(probe(setup(), 'stale_instructions').hit, false);
  const s = setup();
  s.items[0] = instr('/h/.claude/CLAUDE.md', { age: 200 });
  s.items[1] = instr('/r/a/CLAUDE.md', { age: 400, src: 'mtime', layer: 'project' });
  const p = probe(s, 'stale_instructions');
  assert.equal(p.hit, true);
  assert.equal(p.items.length, 2);
  assert.deepEqual(p.items.map((i) => i.date_source).sort(), ['git', 'mtime']);
  assert.equal(p.metric.max_age_days, 400);
});

test('oversized_instructions: over 40 KB always loaded', () => {
  assert.equal(probe(setup(), 'oversized_instructions').hit, false);
  const s = setup({ always_loaded: { max_bytes: 50000, by_project: [{ project: '/r/a', bytes: 50000, files: [{ path: '/h/.claude/CLAUDE.md', bytes: 50000 }] }] } });
  const p = probe(s, 'oversized_instructions');
  assert.equal(p.hit, true);
  assert.equal(p.metric.kb, 49);
});

test('no_owner_or_review: a file missing either line fails', () => {
  assert.equal(probe(setup(), 'no_owner_or_review').hit, false);
  const s = setup();
  s.items[1] = instr('/r/a/CLAUDE.md', { text: '# Rules\n- just rules', layer: 'project' });
  const p = probe(s, 'no_owner_or_review');
  assert.equal(p.hit, true);
  assert.deepEqual(p.items[0].missing, ['owner', 'review date']);
  s.items[1] = instr('/r/a/CLAUDE.md', { text: 'Owner: team\n- rules', layer: 'project' });
  assert.deepEqual(probe(s, 'no_owner_or_review').items[0].missing, ['review date'], 'owner alone still fails');
  s.items[1] = instr('/r/a/CLAUDE.md', { text: 'Reviewed: 2026-10-01\n- rules', layer: 'project' });
  assert.deepEqual(probe(s, 'no_owner_or_review').items[0].missing, ['owner'], 'review date alone still fails');
});

test('owner line patterns accept bullets, bold, and front matter', () => {
  assert.deepEqual(ownerLine('---\nowner: a\nreviewed: 2026-01-02\n---'), { owner: true, reviewed: '2026-01-02' });
  assert.deepEqual(ownerLine('- **Owner:** team\n> Last reviewed: 2026-03-04'), { owner: true, reviewed: '2026-03-04' });
  assert.deepEqual(ownerLine('**Owner:** Jo\n**Reviewed:** 2026-01-01'), { owner: true, reviewed: '2026-01-01' });
  assert.deepEqual(ownerLine('Nobody owns this'), { owner: false, reviewed: null });
});

test('blanket_permissions: blanket shell or write allow, bypass mode, skipped prompt', () => {
  assert.equal(probe(setup(), 'blanket_permissions').hit, false);
  for (const rule of ['Bash', 'Bash(*)', 'Write', 'Edit(**)', 'MultiEdit']) {
    const s = setup({ permissions: { allow: [{ rule, path: 'p' }], ask: [], deny: [], defaultMode: null, skipDangerousModePermissionPrompt: null } });
    assert.equal(probe(s, 'blanket_permissions').hit, true, rule);
  }
  for (const value of ['bypassPermissions', 'acceptEdits']) {
    const s = setup({ permissions: { allow: [], ask: [], deny: [], defaultMode: { value, path: 'p' }, skipDangerousModePermissionPrompt: null } });
    assert.equal(probe(s, 'blanket_permissions').hit, true, value);
  }
  const skip = setup({ permissions: { allow: [], ask: [], deny: [], defaultMode: null, skipDangerousModePermissionPrompt: { value: true, path: 'p' } } });
  assert.equal(probe(skip, 'blanket_permissions').hit, true);
  const scoped = setup({ permissions: { allow: [{ rule: 'Edit(src/**)', path: 'p' }, { rule: 'Read', path: 'p' }], ask: [], deny: [], defaultMode: null, skipDangerousModePermissionPrompt: null } });
  assert.equal(probe(scoped, 'blanket_permissions').hit, false);
});

test('stack_gap: no hooks, skills, or memory from any source', () => {
  assert.equal(probe(setup(), 'stack_gap').hit, false);
  const s = setup();
  s.items = s.items.filter((i) => i.kind === 'instruction');
  const p = probe(s, 'stack_gap');
  assert.equal(p.hit, true);
  assert.deepEqual(p.metric.missing, ['hooks', 'skills', 'memory']);
  const plugin = setup();
  plugin.items = plugin.items.filter((i) => i.kind !== 'hook');
  plugin.items.push({ path: '/p/hooks.json#hooks.PreToolUse[0]', kind: 'hook', source: 'plugin', loaded_by: 'plugin:guard' });
  assert.equal(probe(plugin, 'stack_gap').hit, false, 'plugin hook suppresses the gap');
});

test('short_retention: 30 days or less is informational', () => {
  assert.equal(probe(setup(), 'short_retention').hit, false);
  const p = probe(setup({ retention: { days: 30, source: 'default' } }), 'short_retention');
  assert.equal(p.hit, true);
  assert.equal(p.metric.days, 30);
});

test('structure checks are pass or fail results only', () => {
  const r = runConfigProbes(setup());
  assert.deepEqual(r.structure.map((c) => c.check).sort(), ['instruction_layers', 'instructions_reviewed', 'permissions_scoped', 'repo_layout']);
  for (const c of r.structure) {
    assert.deepEqual(Object.keys(c).sort(), ['applicable', 'check', 'entry_id', 'items', 'pass']);
    assert.equal(c.pass, true, c.check);
  }
});

test('instruction_layers fails when a rule line repeats across layers', () => {
  const s = setup();
  s.items[1] = instr('/r/a/CLAUDE.md', { layer: 'project', text: 'Owner: t\nReviewed: 2026-10-01\n- rule one here' });
  assert.equal(check(s, 'instruction_layers').pass, false);
});

test('repo_layout fails when repos differ, and is not applicable with one repo', () => {
  const s = setup();
  s.repos[1].layout = ['CLAUDE.md'];
  assert.equal(check(s, 'repo_layout').pass, false);
  assert.equal(check(setup({ repos: [{ root: '/r/a', layout: [] }] }), 'repo_layout').applicable, false);
});

test('instructions_reviewed uses the review line, then git, never mtime alone', () => {
  const s = setup();
  s.items[0] = instr('/h/.claude/CLAUDE.md', { text: '- no header', age: 5, src: 'mtime' });
  assert.equal(check(s, 'instructions_reviewed').pass, false);
  s.items[0] = instr('/h/.claude/CLAUDE.md', { text: '- no header', age: 5, src: 'git' });
  assert.equal(check(s, 'instructions_reviewed').pass, true);
  s.items[0] = instr('/h/.claude/CLAUDE.md', { text: 'Reviewed: 2026-01-01', age: 5, src: 'git' });
  assert.equal(check(s, 'instructions_reviewed').pass, false, 'review line wins over a newer git date');
});

test('instructions_reviewed skips a file whose git history was not read, unless it has a review line', () => {
  const s = setup();
  const skipped = (text) => ({ ...instr('/r/a/CLAUDE.md', { layer: 'project', text, age: 5, src: 'mtime' }), last_change: { date: daysAgo(5), source: 'mtime', git_skipped: true } });
  s.items[1] = skipped('- no header');
  const c = check(s, 'instructions_reviewed');
  assert.equal(c.pass, true);
  assert.equal(c.items.some((i) => i.path === '/r/a/CLAUDE.md'), false);
  s.items[1] = skipped('Reviewed: 2026-01-01');
  assert.equal(check(s, 'instructions_reviewed').pass, false, 'a review line still counts');
});

test('permissions_scoped mirrors blanket_permissions', () => {
  const s = setup({ permissions: { allow: [{ rule: 'Bash', path: 'p' }], ask: [], deny: [], defaultMode: null, skipDangerousModePermissionPrompt: null } });
  assert.equal(check(s, 'permissions_scoped').pass, false);
});

test('probes over instruction or memory files are not applicable when there are none', () => {
  const empty = setup({ items: [], always_loaded: { max_bytes: 0, by_project: [] } });
  const applicable = Object.fromEntries(runConfigProbes(empty).probes.map((p) => [p.kind, p.applicable]));
  assert.deepEqual(applicable, {
    stale_instructions: false,
    oversized_instructions: false,
    no_owner_or_review: false,
    blanket_permissions: false,
    stack_gap: true,
    short_retention: true,
  });
  assert.ok(runConfigProbes(setup()).probes.every((p) => p.applicable), 'a full setup runs every probe');
});

test('permission checks are not applicable without a readable settings file', () => {
  const settings = setup().items.find((i) => i.kind === 'settings');
  assert.ok(settings, 'the base setup has a settings file');
  const without = (extra = []) => setup({ items: [...setup().items.filter((i) => i.kind !== 'settings'), ...extra] });
  const cases = {
    'no settings file': without(),
    'settings file that does not parse': without([{ ...settings, parse_error: true }]),
    'only a plugin hooks file': without([{ ...settings, path: '/h/.claude/plugins/cache/m/p/1/hooks/hooks.json', source: 'plugin' }]),
  };
  for (const [name, s] of Object.entries(cases)) {
    assert.equal(probe(s, 'blanket_permissions').applicable, false, name);
    assert.equal(check(s, 'permissions_scoped').applicable, false, name);
  }
  assert.equal(probe(setup(), 'blanket_permissions').applicable, true);
  assert.equal(check(setup(), 'permissions_scoped').applicable, true);
  // A blanket rule found anywhere still counts, whatever the file list says.
  const hit = without();
  hit.permissions = { ...hit.permissions, allow: [{ rule: 'Bash', path: 'p' }] };
  assert.equal(probe(hit, 'blanket_permissions').applicable, true);
  assert.equal(probe(hit, 'blanket_permissions').hit, true);
});

test('repo_layout is not applicable when no repo has any layout file', () => {
  const s = setup({ repos: [{ root: '/r/a', layout: [] }, { root: '/r/b', layout: [] }] });
  assert.equal(check(s, 'repo_layout').applicable, false);
  assert.equal(check(setup(), 'repo_layout').applicable, true);
});
