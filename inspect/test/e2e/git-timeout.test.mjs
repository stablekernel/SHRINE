// A scanned repo whose config includes a FIFO hangs every git run there. The run
// must finish, treat those git reads as failed, and say so in a visible note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { setSpawnTimeout } from '../../src/io/proc.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

// The spawn time limit in these tests is 1 s. A per-test limit bounds the async
// parts; if the spawn limit ever broke, git would block spawnSync itself, and the
// run-wide limit in scripts/test.mjs fails the suite instead of hanging it.
const SPAWN_TEST_TIMEOUT_MS = 30_000;

test('a repo that hangs git ends the read with a visible note, not a hung run', { timeout: SPAWN_TEST_TIMEOUT_MS }, async (t) => {
  if (spawnSync('mkfifo', ['--help'], { stdio: 'ignore' }).error) return t.skip('no mkfifo on this platform');
  const h = makeHome('good', { projectName: 'app' });
  const repo = join(h.tmp, 'work', 'hung');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  writeFileSync(join(repo, 'CLAUDE.md'), '# Rules\n');
  // Nested instruction files: each folder under the hung repo would cost its own time limit if marks were per folder.
  for (const sub of ['svc/a', 'svc/b', 'docs/c']) {
    mkdirSync(join(repo, sub), { recursive: true });
    writeFileSync(join(repo, sub, 'CLAUDE.md'), '# Sub rules\n');
  }
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' };
  for (const a of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'i']]) execFileSync('git', a, { cwd: repo, env });
  execFileSync('mkfifo', [join(h.tmp, 'pipe')]);
  execFileSync('git', ['config', 'include.path', join(h.tmp, 'pipe')], { cwd: repo, env });
  const projDir = join(h.claudeHome, 'projects', encodeProjectPath(repo));
  mkdirSync(projDir, { recursive: true });
  const sid = '00000000-0000-4000-8000-000000000003';
  writeFileSync(join(projDir, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', cwd: repo, entrypoint: 'cli', sessionId: sid })}\n`);
  const state = mkdtempSync(join(tmpdir(), 'si-hung-'));
  const out = [];
  const err = [];
  setSpawnTimeout(1000);
  try {
    const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
      env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
      home: h.home,
      stdin: { isTTY: false },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
    });
    assert.equal(code, 0, err.join(''));
  } finally {
    setSpawnTimeout();
  }
  const s = JSON.parse(out.join(''));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const html = readFileSync(s.report, 'utf8');
  h.cleanup();
  const note = findings.notes.find((n) => n.startsWith('Git did not finish within 1 second in 1 repo and'));
  assert.ok(note, JSON.stringify(findings.notes));
  assert.ok(!findings.notes.some((n) => n.startsWith('Git history was not read')), 'a hung folder is not reported as a partial clone');
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  assert.match(visible, /class="run-limits"[^>]*><p>Git did not finish within 1 second in 1 repo and/, 'a visible run limit, not just data');
});

test('a global git config that hangs git costs one time limit for the run, worded once', { timeout: SPAWN_TEST_TIMEOUT_MS }, async (t) => {
  if (spawnSync('mkfifo', ['--help'], { stdio: 'ignore' }).error) return t.skip('no mkfifo on this platform');
  const h = makeHome('good', { projectName: 'app' });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' };
  for (const name of ['two', 'three']) {
    const repo = join(h.tmp, 'work', name);
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'CLAUDE.md'), '# Rules\n');
    for (const a of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'i']]) execFileSync('git', a, { cwd: repo, env });
    const projDir = join(h.claudeHome, 'projects', encodeProjectPath(repo));
    mkdirSync(projDir, { recursive: true });
    const sid = `00000000-0000-4000-8000-00000000001${name.length}`;
    writeFileSync(join(projDir, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', cwd: repo, entrypoint: 'cli', sessionId: sid })}\n`);
  }
  // git reads the global config from $HOME; the pipe there blocks every git run.
  execFileSync('mkfifo', [join(h.home, 'pipe')]);
  writeFileSync(join(h.home, '.gitconfig'), `[include]\n\tpath = ${join(h.home, 'pipe')}\n`);
  const state = mkdtempSync(join(tmpdir(), 'si-ghung-'));
  const out = [];
  const err = [];
  const realHome = process.env.HOME;
  process.env.HOME = h.home;
  setSpawnTimeout(1000);
  try {
    const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
      env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
      home: h.home,
      stdin: { isTTY: false },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
    });
    assert.equal(code, 0, err.join(''));
  } finally {
    setSpawnTimeout();
    process.env.HOME = realHome;
  }
  const s = JSON.parse(out.join(''));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const spy = readFileSync(join(s.run_dir, 'spy.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  h.cleanup();
  const stopped = spy.filter((e) => e.op === 'spawn' && e.t - e.t_start >= 900);
  assert.equal(stopped.length, 1, `one time limit for the run: ${JSON.stringify(stopped.map((e) => [e.args.at(-1), e.cwd]))}`);
  const hungNotes = findings.notes.filter((n) => n.startsWith('Git did not finish'));
  assert.equal(hungNotes.length, 1, JSON.stringify(findings.notes));
  assert.match(hungNotes[0], /^Git did not finish within 1 second reading your global git config/);
  assert.doesNotMatch(hungNotes[0], /in \d+ repos?/);
  assert.ok(!findings.notes.some((n) => n.startsWith('Git history was not read')), 'not reported as a partial clone');
});
