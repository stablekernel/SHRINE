import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjects, encodeProjectPath, sessionInventory, linkSpawned } from '../../../src/adapters/claude-code/projects.mjs';
import { resetSpy, spyLog } from '../../../src/io/fsread.mjs';
import { scanHistory } from '../../../src/cli/scan.mjs';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const DAY = 86400000;
// Narrow on purpose: os.tmpdir() can itself sit under /private/tmp/claude-*.
const TEMP = ['^/private/tmp/claude-501/scratch$'];

function sh(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
}

const HK = 'Analyze this conversation and determine: the goal';
function session(home, cwd, { id = 's1', entrypoint = 'cli', bytes = 100, ageDays = 1, cwdLine = 2, prompt = 'SECRET-PROMPT' } = {}) {
  const dir = join(home, 'projects', encodeProjectPath(cwd));
  mkdirSync(dir, { recursive: true });
  const lines = [];
  for (let i = 1; i < cwdLine; i++) lines.push(JSON.stringify({ type: 'queue-operation', content: 'SECRET-CONTENT' }));
  lines.push(JSON.stringify({ type: 'user', cwd, entrypoint, sessionId: id, version: '2.1.318', message: { content: prompt } }));
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

test('before consent, temp folders and sdk-cli folders are excluded from cwd and entrypoint alone; the prompt is not used', () => {
  session(home, '/private/tmp/claude-501/scratch', { id: 't' });
  const bot = join(work, 'bot');
  mkdirSync(bot);
  session(home, bot, { id: 'auto', entrypoint: 'sdk-cli', prompt: HK });
  const scribe = join(work, 'scribe');
  mkdirSync(scribe);
  session(home, scribe, { id: 'notes', entrypoint: 'sdk-cli', prompt: 'Write scribe notes' });
  const human = join(work, 'human');
  mkdirSync(human);
  session(home, human, { id: 'h' });
  const r = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.deepEqual(r.projects.map((p) => p.name), ['human']);
  assert.deepEqual(r.excluded.map((e) => e.reason).sort(), ['automation', 'automation', 'temp'], 'housekeeping and spawned look the same before consent');
  assert.ok(!JSON.stringify(r).includes('Analyze this'));
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

test('after consent every file is re-checked: housekeeping counted, spawned linked or unattributed, mixed folders keep interactive sessions', () => {
  const repo = join(work, 'mix');
  mkdirSync(repo);
  session(home, repo, { id: 'human1', ageDays: 3 });
  session(home, repo, { id: 'spawn1', entrypoint: 'sdk-cli', prompt: 'Write scribe notes', ageDays: 2 });
  session(home, repo, { id: 'human2', ageDays: 1 });
  const bot = join(work, 'bot');
  mkdirSync(bot);
  session(home, bot, { id: 'hk1', entrypoint: 'sdk-cli', prompt: HK });
  session(home, bot, { id: 'hk2', entrypoint: 'sdk-cli', prompt: HK, ageDays: 2 });
  session(home, bot, { id: 'botHuman', ageDays: 3 });
  const sub = join(home, 'projects', encodeProjectPath(repo), 'human2', 'subagents');
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, 'agent-a1.jsonl'), 'x'.repeat(500));
  const listing = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(listing.projects[0].bytes_with_subagents, listing.projects[0].bytes + 500);
  assert.equal(listing.excluded[0].reason, 'automation');
  const inv = sessionInventory(listing);
  assert.deepEqual(inv.sessions.map((s) => s.id).sort(), ['botHuman', 'human1', 'human2']);
  assert.equal(inv.sessions.find((s) => s.id === 'botHuman').project, 'bot');
  assert.deepEqual(inv.automation, { housekeeping: 2, total: 5, share: 0.4, spawned: 1 }, "total is the 3 reviewed plus the 2 left out; spawned is not in it");
  assert.deepEqual(inv.spawned.map((s) => s.id), ['spawn1']);
  assert.equal(inv.sessions.find((s) => s.id === 'human2').subagent_files.length, 1);
  assert.equal(inv.harness_version, '2.1.318');
});

test('temp folders: after consent only their sdk-cli files are classified; spawned ones there link by time alone', () => {
  const tmpRoot = '/private/tmp/claude-501/scratch';
  session(home, tmpRoot, { id: 'tmpHuman', ageDays: 2 });
  session(home, tmpRoot, { id: 'tmpScribe', entrypoint: 'sdk-cli', prompt: 'Write scribe notes', ageDays: 1 });
  session(home, tmpRoot, { id: 'tmpHk', entrypoint: 'sdk-cli', prompt: HK, ageDays: 3 });
  const listing = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  assert.equal(listing.excluded[0].reason, 'temp');
  const inv = sessionInventory(listing);
  assert.deepEqual(inv.sessions, [], 'interactive temp sessions stay unread');
  assert.deepEqual(inv.spawned.map((s) => [s.id, s.temp]), [['tmpScribe', true]]);
  assert.deepEqual(inv.automation, { housekeeping: 1, total: 1, share: 1, spawned: 1 }, "no session reviewed here, so only the housekeeping one is in the total");
  const r = linkSpawned([{ id: 'x', root: tmpRoot, temp: true, start: '2026-11-01T10:40:00Z' }], [{ id: 'p', root: '/w/r', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z' }]);
  assert.equal(r.linked, 1);
});

test('spawned sessions link to the session running in the same repo at that time; others are unattributed', () => {
  const sessions = [
    { id: 'a', root: '/w/r', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z' },
    { id: 'b', root: '/w/r', start: '2026-11-01T10:30:00Z', end: '2026-11-01T12:00:00Z' },
  ];
  const spawned = [
    { id: 's1', root: '/w/r', start: '2026-11-01T10:40:00Z' },
    { id: 's2', root: '/w/r', start: '2026-11-01T12:03:00Z' },
    { id: 's3', root: '/w/other', start: '2026-11-01T10:40:00Z' },
    { id: 's4', root: '/w/r', start: '2026-11-01T15:00:00Z' },
  ];
  const r = linkSpawned(spawned, sessions);
  assert.deepEqual([...r.parents], [['b', 2]], 'latest-starting parent wins; 5 minutes of slack');
  assert.equal(r.linked, 2);
  assert.equal(r.unattributed, 2);
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

test('a cwd inside a git submodule resolves to the submodule work tree', async () => {
  const { repoRoot } = await import('../../../src/adapters/claude-code/projects.mjs');
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'si-sub-')));
  const lib = join(base, 'lib');
  const sup = join(base, 'super');
  for (const r of [lib, sup]) {
    mkdirSync(r);
    sh(r, 'init', '-q');
    sh(r, 'commit', '-q', '--allow-empty', '-m', 'x');
  }
  sh(sup, '-c', 'protocol.file.allow=always', 'submodule', '-q', 'add', lib, 'vendor/lib');
  const sub = join(sup, 'vendor', 'lib');
  assert.equal(repoRoot(sub), sub);
  assert.equal(repoRoot(sup), sup);
});

test('housekeeping denominator counts only reviewed sessions plus housekeeping: own, unreadable, and spawned files are left out', async () => {
  const repo = join(work, 'den');
  mkdirSync(repo);
  const ok = (id, ageDays) => {
    const f = session(home, repo, { id, ageDays });
    const ts = new Date(NOW - ageDays * DAY).toISOString();
    const line = (type, message) => JSON.stringify({ type, cwd: repo, entrypoint: 'cli', sessionId: id, version: '2.1.318', timestamp: ts, message });
    writeFileSync(f, `${line('user', { role: 'user', content: 'Fix the parser.' })}\n${line('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] })}\n`);
    utimesSync(f, (NOW - ageDays * DAY) / 1000, (NOW - ageDays * DAY) / 1000);
  };
  ok('read1', 4);
  ok('read2', 3);
  ok('own', 1);
  session(home, repo, { id: 'unreadable', ageDays: 2 });
  session(home, repo, { id: 'spawn1', entrypoint: 'sdk-cli', prompt: 'Write scribe notes', ageDays: 2 });
  session(home, repo, { id: 'hk1', entrypoint: 'sdk-cli', prompt: HK, ageDays: 2 });
  const listing = listProjects({ claudeHome: home, now: NOW, windowDays: 30, tempPatterns: TEMP });
  const r = await scanHistory({ listing, excludedIds: ['own'] });
  assert.deepEqual(r.sessions.map((s) => s.id).sort(), ['read1', 'read2']);
  const a = r.usage.automation;
  assert.deepEqual([a.housekeeping, a.total, a.share, a.spawned], [1, 3, 0.333, 1], 'total = 2 reviewed + 1 left out');
});
