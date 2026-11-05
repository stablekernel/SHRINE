import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionFile, sniffType, SKIP_TYPES } from '../../../src/adapters/claude-code/stream.mjs';

const dir = mkdtempSync(join(tmpdir(), 'si-stream-'));
const file = (name, lines) => {
  const p = join(dir, name);
  writeFileSync(p, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
  return p;
};
const base = { timestamp: '2026-11-01T10:00:00.000Z', sessionId: 's1', version: '2.1.318' };
const user = (text, extra = {}) => ({ type: 'user', ...base, message: { role: 'user', content: text }, ...extra });
// Real assistant lines put `message` (with a nested "type":"message") before the top-level type.
const assistant = (text) => ({ parentUuid: null, message: { type: 'message', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } }, requestId: 'r1', type: 'assistant', ...base });

async function collect(path) {
  const events = [];
  const stats = await readSessionFile(path, (e) => events.push(e));
  return { events, stats };
}

test('sniff reads only the first top-level-looking type in 200 bytes', () => {
  assert.equal(sniffType('{"type":"queue-operation","x":1}'), 'queue-operation');
  assert.equal(sniffType(JSON.stringify(assistant('hi'))), 'message');
  assert.equal(sniffType(`{"pad":"${'x'.repeat(300)}","type":"ai-title"}`), null);
});

test('known skip types are skipped without JSON.parse; read types are delivered', async () => {
  const skipped = [...SKIP_TYPES].map((t) => `{"type":"${t}", not json at all`);
  const p = file('skip.jsonl', [user('hello'), ...skipped, assistant('done')]);
  const { events, stats } = await collect(p);
  assert.deepEqual(events.map((e) => e.type), ['user', 'assistant']);
  assert.equal(stats.skipped_by_sniff, SKIP_TYPES.size);
  assert.equal(stats.corrupt, 0, 'skipped lines were never parsed');
});

test('an assistant line with message before type is never skipped', async () => {
  const p = file('order.jsonl', [assistant('a nested "type":"queue-operation" in text')]);
  const { events } = await collect(p);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'assistant');
});

test('cost-state is never parsed and never delivered', async () => {
  const p = file('cost.jsonl', [user('x'), '{"type":"cost-state","usd":{broken']);
  const { events, stats } = await collect(p);
  assert.equal(events.length, 1);
  assert.equal(stats.corrupt, 0);
});

test('attachment subtypes are filtered after parse', async () => {
  const att = (t) => ({ parentUuid: null, attachment: { type: t }, type: 'attachment', ...base });
  const p = file('att.jsonl', [att('instructions'), att('deferred_tools_delta'), att('queued_command')]);
  const { events } = await collect(p);
  assert.deepEqual(events.map((e) => e.attachment.type), ['instructions', 'queued_command']);
});

test('unknown types are counted; corrupt lines counted and the file kept', async () => {
  const p = file('mixed.jsonl', [user('a'), { type: 'frame-link', ...base }, { type: 'brand-new-type', ...base }, '{"type":"user", broken', user('b')]);
  const { events, stats } = await collect(p);
  assert.equal(events.length, 2);
  assert.equal(stats.corrupt, 1);
  assert.deepEqual(stats.unknown_types, { 'brand-new-type': 1 });
  assert.equal(stats.kind, 'session');
  assert.equal(stats.version, '2.1.318');
});

test('version-less job logs with only launched, started, result lines are non-session files', async () => {
  const p = file('job.jsonl', [{ type: 'launched', at: 1 }, { type: 'started', at: 2 }, { type: 'result', at: 3 }]);
  const { events, stats } = await collect(p);
  assert.equal(events.length, 0);
  assert.equal(stats.kind, 'job_log');
});

test('user and assistant lines missing core keys are dropped and counted', async () => {
  const p = file('core.jsonl', [{ type: 'user', message: { role: 'user', content: 'x' } }, user('ok')]);
  const { events, stats } = await collect(p);
  assert.equal(events.length, 1);
  assert.equal(stats.core_missing, 1);
});

test('an unreadable file reports unreadable instead of throwing', async () => {
  const p = file('locked.jsonl', [user('x')]);
  chmodSync(p, 0o000);
  const { stats } = await collect(p);
  chmodSync(p, 0o600);
  // root can read anything; the reason is still a known value
  assert.ok(['unreadable', 'session'].includes(stats.kind));
  const missing = await collect(join(dir, 'nope.jsonl'));
  assert.equal(missing.stats.kind, 'unreadable');
});

test('a 100 MB file streams with heap growth under 100 MB (RSS is GC-lagged, checked loosely)', async () => {
  const p = join(dir, 'big.jsonl');
  const line = `${JSON.stringify(user('y'.repeat(4000)))}\n`;
  const ws = createWriteStream(p);
  const n = Math.ceil((100 * 1024 * 1024) / line.length);
  for (let i = 0; i < n; i++) if (!ws.write(line)) await new Promise((r) => ws.once('drain', r));
  await new Promise((r) => ws.end(r));
  global.gc?.();
  const before = process.memoryUsage();
  let peak = before.heapUsed;
  let peakRss = before.rss;
  let count = 0;
  await readSessionFile(p, () => {
    count++;
    if (count % 2000 === 0) {
      const m = process.memoryUsage();
      peak = Math.max(peak, m.heapUsed);
      peakRss = Math.max(peakRss, m.rss);
    }
  });
  assert.equal(count, n);
  assert.ok(peak - before.heapUsed < 100 * 1024 * 1024, `heap grew ${Math.round((peak - before.heapUsed) / 1048576)} MB`);
  assert.ok(peakRss - before.rss < 200 * 1024 * 1024, `rss grew ${Math.round((peakRss - before.rss) / 1048576)} MB`);
});
