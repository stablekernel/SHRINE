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
import { addHistory, addSession, COMMIT_AT_MS, PRESETS } from '../synth/history.mjs';
import { openRepo } from '../synth/repos.mjs';
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
  for (const re of [/^Rework \(named reverts\) within 72 hours: \d+ of \d+ episodes? with linked commits/, /^Possible rework \(later-session fix\)/, /^Possible rework \(file overlap\)/, /^Iteration commits: /]) {
    assert.ok(u.lines.some((l) => re.test(l)), String(re));
  }
  h.cleanup();
});

test('rework from real commits: a named revert in a later session is rework; a later-session fix is a candidate', async () => {
  const h = home('good', 'clean');
  const repo = openRepo(h.repo);
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600000;
  const T = NOW - 10 * DAY;
  const id = (n) => `abab0000-0000-4000-8000-00000000000${n}`;
  repo.commit(iso(T - H), 'base', { 'src/parser.js': 'v0', 'src/lexer.js': 'v0' });
  // S1 makes the commit; S2 reverts it by name 3 hours later; S3 fixes the same file 5 hours later.
  addSession(h, { id: id(1), startMs: T, script: PRESETS.committing(1) });
  const made = repo.commit(iso(T + COMMIT_AT_MS), 'feat: parser step 1', { 'src/parser.js': 'v1', 'src/lexer.js': 'v1' });
  addSession(h, { id: id(2), startMs: T + 3 * H, script: [['human', 'Undo the parser step.'], ['bash', `git revert --no-edit ${made.slice(0, 7)}`]] });
  repo.revert(iso(T + 3 * H + COMMIT_AT_MS), made);
  addSession(h, { id: id(3), startMs: T + 5 * H, script: PRESETS.committing(3) });
  repo.commit(iso(T + 5 * H + COMMIT_AT_MS), 'fix: parser empty input', { 'src/parser.js': 'v2' });
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  const c = r.findings.usage.counts;
  assert.ok(c.committed >= 2, `committed ${c.committed}`);
  assert.ok(c.rework >= 1, `rework ${c.rework}`);
  assert.ok(c.possible_fix >= 1, `possible_fix ${c.possible_fix}`);
  const ep = r.facts.episodes.find((e) => e.commits.includes(made));
  assert.equal(ep.stratum.outcome, 'rework');
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

test('sdk-cli sessions: housekeeping counted, spawned work linked as byproducts or unattributed, mixed folders keep interactive sessions', async () => {
  const h = home('good', 'clean');
  const bot = join(h.tmp, 'work', 'bot');
  // A folder whose newest file is housekeeping, with one older interactive session in it.
  addHistory(h, 'clean', { nowMs: NOW, prefix: 'dddd', count: 1, cwd: bot });
  addHistory(h, 'housekeeping', { nowMs: NOW, prefix: 'bbbb', entrypoint: 'sdk-cli', count: 4, first: 5, cwd: bot });
  // In the project folder: 3 spawned during clean sessions, 1 spawned with no parent, 1 housekeeping.
  addHistory(h, 'spawned', { nowMs: NOW, prefix: 'cccc', entrypoint: 'sdk-cli', count: 3, offsetMs: 60000 });
  addHistory(h, 'spawned', { nowMs: NOW, prefix: 'eeee', entrypoint: 'sdk-cli', count: 1, offsetMs: 6 * 3600000 });
  addHistory(h, 'housekeeping', { nowMs: NOW, prefix: 'ffff', entrypoint: 'sdk-cli', count: 1, offsetMs: 7 * 3600000 });
  const r = await runWithHistory(h);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.findings.findings, []);
  assert.deepEqual(r.findings.usage.automation, { housekeeping: 5, spawned: 4, total: 23, share: 0.217, spawned_linked: 3, spawned_parents: 3, unattributed: 1 });
  const lines = r.findings.usage.lines;
  assert.ok(lines.includes('Housekeeping automation left out: 5 of 23 sessions (22%)'));
  assert.ok(lines.includes('Spawned automation: 3 sessions linked to 3 of your sessions as byproducts, not judged'));
  assert.ok(lines.includes('Unattributed automation: 1 session with no parent session found, not read'));
  assert.equal(r.findings.usage.counts.sessions, 13, '12 clean plus the interactive session in the housekeeping folder');
  assert.equal(r.facts.sessions.filter((s) => s.byproducts > 0).length, 3);
  const streamed = r.spy.filter((e) => e.stream).map((e) => e.path);
  assert.ok(!streamed.some((p) => /\/(bbbb|cccc|eeee|ffff)/.test(p)), 'sdk-cli sessions are never read in full');
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
