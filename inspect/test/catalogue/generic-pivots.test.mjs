import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyProblemsDeep } from '../../src/copy/rules.mjs';

const load = (p) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../src/catalogue/${p}`, import.meta.url)), 'utf8'));
const pivots = load('generic-pivots.json');
const ids = load('entry-ids.json');
const kinds = load('t0-kinds.json');
const PIVOT_KINDS = new Set(['habit', 'instruction', 'skill', 'hook', 'gate', 'config']);

const t0Ids = [...new Set(Object.values({ ...kinds.kinds, ...kinds.usage_kinds }).map((k) => k.entry_ids[0]))];

test('every T0 kind cites entry ids that exist in entry-ids.json', () => {
  for (const [kind, k] of Object.entries({ ...kinds.kinds, ...kinds.usage_kinds, ...kinds.structure })) {
    for (const id of k.entry_ids) assert.ok(ids[id], `${kind}: ${id} missing`);
  }
});

test('the 6 config kinds are present', () => {
  assert.deepEqual(Object.keys(kinds.kinds).sort(), [
    'blanket_permissions',
    'no_owner_or_review',
    'oversized_instructions',
    'short_retention',
    'stack_gap',
    'stale_instructions',
  ]);
});

test('every T0 entry id has a complete generic pivot', () => {
  for (const id of t0Ids) {
    const p = pivots[id];
    assert.ok(p, `no pivot for ${id}`);
    for (const f of ['action', 'before', 'after', 'setup_note', 'kind']) assert.equal(typeof p[f], 'string', `${id}.${f}`);
    assert.ok(p.action && p.before && p.after, `${id} has empty text`);
    assert.ok(PIVOT_KINDS.has(p.kind), `${id}.kind ${p.kind}`);
  }
});

test('generic pivots pass copy lint', () => {
  assert.deepEqual(copyProblemsDeep(pivots), []);
});
