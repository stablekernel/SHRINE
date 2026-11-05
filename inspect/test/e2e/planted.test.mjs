// Planted-failure suite with synthetic histories (plan T2.11, E5: 3 plants; the
// done-without-test kind and the retry count are appendix counts). Runs the real
// CLI in process with history consent answered on a fake TTY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory } from '../synth/history.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
const PLANTS = ['stale_instructions', 'blanket_permissions', 'oversized_instructions'];
const sink = () => {
  const c = [];
  return { write: (s) => c.push(String(s)), text: () => c.join('') };
};

async function runWithHistory(h) {
  const state = mkdtempSync(join(tmpdir(), 'si-pl-'));
  const stdout = sink();
  const stderr = sink();
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const stdin = Object.assign(Readable.from(['history\n']), { isTTY: true });
  const code = await main(['run', '--tier', 'T0', '--json'], { env, home: h.home, stdin, stdout, stderr });
  const dir = JSON.parse(stdout.text() || '{}').run_dir;
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  return { code, stderr: stderr.text(), dir, findings: dir && JSON.parse(read('findings.json')), facts: dir && JSON.parse(read('facts.json')), spy: dir && read('spy.jsonl').trim().split('\n').map((l) => JSON.parse(l)), read };
}

function treeHash(root) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const s = lstatSync(p);
      h.update(`${relative(root, p)}|${s.mode}|${s.size}|${s.mtimeMs}\n`);
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) h.update(readFileSync(p));
    }
  };
  walk(root);
  return h.digest('hex');
}

const home = (name, preset, opts = {}) => {
  const h = makeHome(name, { sessionMtime: new Date(NOW - 25 * DAY) });
  if (preset) addHistory(h, preset, { nowMs: NOW, ...opts });
  return h;
};

test('planted: recall of the 3 planted kinds is 80% or more; usage stays in the appendix with the retry count', async () => {
  const h = home('bad', 'planted');
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  const kinds = new Set(r.findings.findings.map((f) => f.kind));
  const recall = PLANTS.filter((k) => kinds.has(k)).length / PLANTS.length;
  assert.ok(recall >= 0.8, `recall ${recall}`);
  assert.ok(!r.findings.findings.some((f) => f.lens === 'usage'), 'no usage finding at T0 (E5)');
  const u = r.findings.usage;
  assert.equal(u.counts.sessions, 12);
  assert.ok(u.counts.retries >= 12, 'one ls retry per planted session');
  assert.ok(u.counts.done_without_test >= 12);
  assert.ok(u.counts.correction_candidates >= 12);
  assert.ok(u.lines.some((l) => /^Identical tool-call retries: \d+ of \d+ tool calls/.test(l)));
  assert.ok(u.lines.some((l) => /^Done claims with no test or check run before them/.test(l)));
  assert.match(r.read('report.html'), /Usage from session history/);
  h.cleanup();
});

for (const preset of ['clean', 'expert']) {
  test(`${preset} history on a good setup: zero findings, nothing in amplify above low`, async () => {
    const h = home('good', preset);
    const r = await runWithHistory(h);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.findings.findings.map((f) => f.kind), []);
    assert.ok(!r.findings.findings.some((f) => f.tab === 'amplify' && f.severity.label !== 'low'));
    assert.equal(r.findings.history.read, true);
    assert.equal(r.findings.usage.counts.done_without_test, 0);
    h.cleanup();
  });
}

test('automation sessions add no findings and show as one appendix line with count and share', async () => {
  const h = home('good', 'clean');
  // An automation-only folder plus automation sessions mixed into the project folder.
  addHistory(h, 'planted', { nowMs: NOW, prefix: 'bbbb', entrypoint: 'sdk-cli', count: 4, cwd: join(h.tmp, 'work', 'bot') });
  addHistory(h, 'planted', { nowMs: NOW - DAY / 2, prefix: 'cccc', entrypoint: 'sdk-cli', count: 3 });
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.findings.findings, []);
  assert.deepEqual(r.findings.usage.automation, { count: 7, total: 20, share: 0.35 });
  assert.ok(r.findings.usage.lines.includes('Automation sessions left out: 7 of 20 sessions (35%)'));
  assert.equal(r.findings.usage.counts.done_without_test, 0, 'planted automation sessions are never read');
  h.cleanup();
});

test('zero model calls: the spawn log holds only allowlisted git; home tree byte-identical; share-safe copy leaks no identifier', async () => {
  const h = home('bad', 'planted');
  const before = treeHash(h.tmp);
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(treeHash(h.tmp), before);
  const spawns = r.spy.filter((e) => e.op === 'spawn');
  assert.ok(spawns.length > 0);
  for (const s of spawns) assert.equal(s.cmd, 'git', `non-git spawn ${s.cmd}`);
  assert.ok(r.spy.filter((e) => e.stream).length >= 12, 'session logs were streamed');
  assert.ok(r.spy.every((e) => e.op !== 'open' || e.mode === 'r'));
  assert.equal(JSON.parse(r.read('verify.json')).ok, true);
  const safe = r.read('report.share-safe.html');
  for (const leak of [h.home, h.tmp, 'bad-project', 'Fixture Author', 'author@fixture.example', 'keep the old function name']) assert.ok(!safe.includes(leak), `share-safe leaks ${leak}`);
  const facts = r.read('facts.json');
  assert.ok(!facts.includes('keep the old function name'), 'no prompt text at rest');
  h.cleanup();
});

test('core keys missing in every session file: setup-only report and exit 4', async () => {
  const h = makeHome('good', { sessionMtime: new Date(NOW - 25 * DAY) });
  const dir = join(h.claudeHome, 'projects', encodeProjectPath(h.repo));
  writeFileSync(join(dir, 'broken-1.jsonl'), `${JSON.stringify({ type: 'user', cwd: h.repo, message: { role: 'user', content: 'x' } })}\n`);
  const r = await runWithHistory(h);
  assert.equal(r.code, 4, r.stderr);
  assert.equal(r.findings.history.read, false);
  assert.match(r.findings.notes.join(' '), /none could be parsed/);
  assert.ok(r.findings.skipped_files.length >= 1);
  h.cleanup();
});
