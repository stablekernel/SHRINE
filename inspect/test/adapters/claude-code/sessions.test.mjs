import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownSession, excludeSessions, GROWING_MS } from '../../../src/adapters/claude-code/sessions.mjs';
import { parseArgs } from '../../../src/cli/main.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const listing = (files) => ({ projects: [{ name: 'app', files: files.map(([id, ago]) => ({ path: `/h/.claude/projects/-w-app/${id}.jsonl`, bytes: 10, mtime: NOW - ago })) }] });

test('--session-id excludes that session', () => {
  const l = listing([['a', 1000], ['b', 10 * 60000]]);
  assert.deepEqual(ownSession(l, { sessionId: 'b', now: NOW }), { id: 'b', project: 'app', reason: 'flag' });
});

test('without the flag the newest still-growing session is excluded', () => {
  const l = listing([['old', 60 * 60000], ['live', 30000]]);
  assert.deepEqual(ownSession(l, { now: NOW }), { id: 'live', project: 'app', reason: 'growing' });
});

test('nothing is excluded when no session grew in the last 5 minutes', () => {
  assert.equal(ownSession(listing([['old', GROWING_MS + 1]]), { now: NOW }), null);
  assert.equal(ownSession({ projects: [] }, { now: NOW }), null);
});

test('--session-id parses in both forms and rejects odd ids', () => {
  assert.equal(parseArgs(['run', '--session-id', 'abc-1']).sessionId, 'abc-1');
  assert.equal(parseArgs(['run', '--session-id=abc-2']).sessionId, 'abc-2');
  assert.throws(() => parseArgs(['run', '--session-id', '../x']), /bad --session-id/);
  assert.throws(() => parseArgs(['run', '--session-id']), /bad --session-id/);
});

test('excludeSessions drops the excluded ids only', () => {
  assert.deepEqual(excludeSessions([{ id: 'a' }, { id: 'b' }], ['b']), [{ id: 'a' }]);
});
