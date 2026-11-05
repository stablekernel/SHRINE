import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjects, encodeProjectPath } from '../../../src/adapters/claude-code/projects.mjs';
import { resetSpy, spyLog } from '../../../src/io/fsread.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const DAY = 86400000;
const TEMP = ['^/private/tmp/claude'];

function sh(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
}

function session(home, cwd, { id = 's1', entrypoint = 'cli', bytes = 100, ageDays = 1, cwdLine = 2 } = {}) {
  const dir = join(home, 'projects', encodeProjectPath(cwd));
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 1; i < cwdLine; i++) lines.push(JSON.stringify({ type: 'queue-operation', content: 'SECRET-CONTENT' }));
  lines.push(JSON.stringify({ type: 'user', cwd, entrypoint, sessionId: id, message: { content: 'SECRET-PROMPT' } }));
  let text = `${lines.join('\n')}\n`;
  text += 'x'.repeat(Math.max(0, bytes - text.length));
  const f = join(dir, `${id}.jsonl`);
  writeFileSync(f, text);
  const t = (NOW - ageDays * DAY) / 1000;
  utimesSync(f, t, t);
  return f;
}

let home;
let work;
beforeEach(() => {
  resetSpy();
  home = mkdtempSync(join(tmpdir(), 'si-home-'));
  work = realpathSync(mkdtempSync(join(tmpdir(), 'si-work-')));
});

test('names a project from the first line carrying cwd and groups by git root', () => {
  const repo = join(work, 'shop');
  mkdirSync(repo);
  sh(repo, 'init', '-q');
  mkdirSync(join(repo, 'api'));
  session(home, repo, { id: 'a' });
  session(home, join(repo, 'api'), { id: 'b' });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, 'shop');
  assert.equal(r.projects[0].root, repo);
  assert.equal(r.projects[0].sessions, 2);
});

test('reads at most 10 lines for cwd', () => {
  const repo = join(work, 'late');
  mkdirSync(repo);
  session(home, repo, { cwdLine: 11 });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects.length, 0);
  assert.equal(r.excluded[0].reason, 'no_cwd');
});

test('worktree cwds group with their main repo', () => {
  const repo = join(work, 'app');
  mkdirSync(repo);
  sh(repo, 'init', '-q');
  writeFileSync(join(repo, 'f'), 'x');
  sh(repo, 'add', 'f');
  sh(repo, 'commit', '-q', '-m', 'init');
  sh(repo, 'worktree', 'add', '-q', join(repo, '.worktrees', 'feat-a'));
  session(home, repo, { id: 'a' });
  session(home, join(repo, '.worktrees', 'feat-a'), { id: 'b' });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].root, repo);
});

test('removed worktree folders fall back to stripping /.worktrees/<name>', () => {
  const repo = join(work, 'gone');
  mkdirSync(repo);
  sh(repo, 'init', '-q');
  session(home, join(repo, '.worktrees', 'feat-removed'), { id: 'a' });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects[0].root, repo);
});

test('temp folders and sdk-cli sessions are excluded and listed', () => {
  session(home, '/private/tmp/claude-501/scratch', { id: 't' });
  const repo = join(work, 'bot');
  mkdirSync(repo);
  session(home, repo, { id: 'auto', entrypoint: 'sdk-cli' });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects.length, 0);
  assert.deepEqual(r.excluded.map((e) => e.reason).sort(), ['automation', 'temp']);
});

test('default view is the top 20 by bytes in the window, rest behind show all', () => {
  for (let i = 0; i < 23; i++) {
    const p = join(work, `p${String(i).padStart(2, '0')}`);
    mkdirSync(p);
    session(home, p, { id: `s${i}`, bytes: 1000 + i * 10 });
  }
  const old = join(work, 'old');
  mkdirSync(old);
  session(home, old, { id: 'old', bytes: 99999, ageDays: 60 });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(r.projects.length, 23, 'out-of-window project not listed');
  assert.equal(r.top.length, 20);
  assert.equal(r.more, 3);
  assert.equal(r.top[0].name, 'p22');
});

test('spy log proves only one file per folder was opened, and no content kept', () => {
  const repo = join(work, 'one');
  mkdirSync(repo);
  session(home, repo, { id: 'a', ageDays: 2 });
  const newest = session(home, repo, { id: 'b', ageDays: 1 });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  const opens = spyLog().filter((e) => e.op === 'open');
  assert.deepEqual(opens.map((e) => e.path), [newest]);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  assert.equal(r.projects[0].sessions, 2);
});
