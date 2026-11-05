import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoCommits, linkEpisodes } from '../../src/episodes/link.mjs';
import { resetSpy, spyLog } from '../../src/io/fsread.mjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureGitEnv, makeRepo } from '../synth/repos.mjs';

const H = 3600000;
const T0 = Date.parse('2026-10-20T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const ep = (id, startMs, endMs, extra = {}) => ({ id, repo: null, start: iso(startMs), end: iso(endMs), committed: false, touched_files: [], ...extra });

test('reverts by SHA and fixups link to the episode that made the commit; amends are ignored', () => {
  const r = makeRepo();
  const base = r.commit(iso(T0 - 48 * H), 'base');
  const agent = r.commit(iso(T0 + 10 * 60000), 'add parser', { 'src/p.js': 'v1' });
  r.amend(iso(T0 + 12 * 60000), 'amended');
  const amended = r.git(['rev-parse', 'HEAD']);
  r.commit(iso(T0 + 5 * H), `fixup! add parser`, { 'src/q.js': 'v2' });
  r.revert(iso(T0 + 30 * H), amended);
  r.commit(iso(T0 + 100 * H), 'fixup! add parser', { 'src/r.js': 'late' });
  const commits = repoCommits(r.root, { since: T0 - 72 * H, until: T0 + 200 * H });
  assert.ok(!commits.some((c) => c.sha === agent), 'the pre-amend commit is not in history');
  assert.ok(commits.some((c) => c.sha === base));
  const e = ep('e1', T0, T0 + 15 * 60000, { repo: r.root, committed: true });
  const [out] = linkEpisodes([e], new Map([[r.root, commits]]));
  assert.deepEqual(out.commits, [amended]);
  const kinds = out.downstream.map((d) => `${d.kind}:${d.link}`).sort();
  assert.deepEqual(kinds, ['fixup:soft', 'revert:hard'], 'the fixup after 72h is not linked');
  assert.ok(out.downstream.every((d) => d.delta_hours <= 72));
  assert.equal(out.rework, true, 'a named revert is rework');
  assert.equal(out.possible_fix, true, 'a later fixup over 1 hour after is a candidate');
  r.cleanup();
});

test('an episode with no commit tool call claims no commits', () => {
  const r = makeRepo();
  r.commit(iso(T0 + 60000), 'human commit');
  const commits = repoCommits(r.root, { since: T0 - H, until: T0 + H });
  const [out] = linkEpisodes([ep('e1', T0, T0 + 5 * 60000, { repo: r.root })], new Map([[r.root, commits]]));
  assert.deepEqual(out.commits, []);
  assert.equal(out.rework, false);
  r.cleanup();
});

test('a later episode re-touching a file within 72h is a soft link; after 72h it is not', () => {
  const f = '/w/repo/src/a.js';
  const e1 = ep('e1', T0, T0 + H, { repo: '/w/repo', touched_files: [f] });
  const e2 = ep('e2', T0 + 10 * H, T0 + 11 * H, { repo: '/w/repo', touched_files: [f, '/w/repo/b.js'] });
  const e3 = ep('e3', T0 + 90 * H, T0 + 91 * H, { repo: '/w/repo', touched_files: ['/w/repo/b.js'] });
  const e4 = ep('e4', T0 + 2 * H, T0 + 3 * H, { repo: '/w/other', touched_files: [f] });
  const out = linkEpisodes([e1, e2, e3, e4], new Map());
  assert.deepEqual(out[0].downstream, [{ kind: 'episode', ref: 'e2', delta_hours: 9, link: 'soft' }]);
  assert.equal(out[0].rework, false, 'file overlap alone is not rework');
  assert.equal(out[0].possible_rework, true);
  assert.deepEqual(out[1].downstream, [], 'e3 is 79 hours after e2');
  assert.equal(out[3].downstream.length, 0, 'other repo never links');
});

test('downstream keeps at most 5 links, nearest first', () => {
  const f = '/w/r/x.js';
  const eps = [ep('e0', T0, T0 + H, { repo: '/w/r', touched_files: [f] })];
  for (let i = 1; i <= 7; i++) eps.push(ep(`e${i}`, T0 + (i + 1) * H, T0 + (i + 1) * H + 60000, { repo: '/w/r', touched_files: [f] }));
  const [first] = linkEpisodes(eps, new Map());
  assert.equal(first.downstream.length, 5);
  assert.deepEqual(first.downstream.map((d) => d.ref), ['e1', 'e2', 'e3', 'e4', 'e5']);
});

test('the linker runs only allowlisted read-only git', () => {
  const r = makeRepo();
  r.commit(iso(T0), 'one');
  resetSpy();
  repoCommits(r.root, { since: T0 - H, until: T0 + H });
  const spawns = spyLog().filter((e) => e.op === 'spawn');
  assert.ok(spawns.length >= 1);
  assert.ok(spawns.some((s) => s.args.includes('log')), 'the linker ran git log');
  for (const s of spawns) {
    assert.equal(s.cmd, 'git');
    // Besides log: the two fixed reads that decide whether history is safe to read.
    const fixed = s.args.at(-1) === '--version' || (s.args.includes('config') && s.args.includes('--get-regexp'));
    assert.ok(s.args.includes('log') || fixed, s.args.join(' '));
  }
  assert.deepEqual(repoCommits('/nowhere/at/all', { since: 0, until: 1 }), []);
  r.cleanup();
});

test('the file-list log turns off rename detection, so a partial clone never fetches blobs', () => {
  const r = makeRepo();
  r.commit(iso(T0), 'one', { 'a.js': 'v1' });
  resetSpy();
  repoCommits(r.root, { since: T0 - H, until: T0 + H });
  const named = spyLog().filter((e) => e.op === 'spawn' && e.args.includes('--name-only'));
  assert.equal(named.length, 1);
  assert.ok(named[0].args.includes('--no-renames'));
  r.cleanup();
});

// Guards against an all-pairs scan: 8 times the episodes costs about 8 times the
// work when linear, 64 times when quadratic. Best-of-3 CPU time, so other test
// files running in parallel do not skew it; observed ratios are 6 to 11.
test('soft links scale linearly: 8 times the episodes costs well under 64 times the CPU', () => {
  const mk = (n) => {
    const eps = [];
    for (let i = 0; i < n; i++) eps.push(ep(`e${i}`, T0 + i * 600000, T0 + i * 600000 + 300000, { repo: `/w/r${i % 4}`, touched_files: [`/w/r${i % 4}/f${i % 50}.js`] }));
    return eps;
  };
  const cpu = (eps) => {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const c = process.cpuUsage();
      linkEpisodes(eps, new Map());
      const d = process.cpuUsage(c);
      best = Math.min(best, d.user + d.system);
    }
    return best;
  };
  cpu(mk(2000));
  const small = cpu(mk(5000));
  const large = mk(40000);
  const ratio = cpu(large) / small;
  assert.ok(ratio < 24, `ratio ${ratio.toFixed(1)}`);
  assert.ok(linkEpisodes(large, new Map())[0].downstream.length > 0);
});

// A teammate commit on another ref, as a fetch leaves it.
function teammateCommit(r, date, subject, file) {
  const env = { ...fixtureGitEnv(date), GIT_AUTHOR_EMAIL: 'mate@fixture.example', GIT_COMMITTER_EMAIL: 'mate@fixture.example' };
  const run = (args) => execFileSync('git', args, { cwd: r.root, encoding: 'utf8', env }).trim();
  run(['checkout', '-q', '-b', 'mate']);
  writeFileSync(join(r.root, file), `${subject}\n`);
  run(['add', '-A']);
  run(['commit', '-q', '-m', subject]);
  const sha = run(['rev-parse', 'HEAD']);
  run(['checkout', '-q', 'main']);
  return sha;
}

test('overlapping sessions on one repo each own only their commits; a teammate commit is nobody\'s; one revert marks one episode', () => {
  const r = makeRepo();
  r.commit(iso(T0 - H), 'base', { 'base.txt': 'v0' });
  const a = r.commit(iso(T0 + 10 * 60000), 'feat: a', { 'a.txt': 'a1' });
  const mate = teammateCommit(r, iso(T0 + 15 * 60000), 'feat: mate', 'm.txt');
  const b = r.commit(iso(T0 + 20 * 60000), 'feat: b', { 'b.txt': 'b1' });
  const rv = r.revert(iso(T0 + 5 * H), a);
  const commits = repoCommits(r.root, { since: T0 - 2 * H, until: T0 + 80 * H });
  assert.ok(commits.some((c) => c.sha === mate), 'the teammate commit is in the log');
  const e1 = ep('e1', T0, T0 + 30 * 60000, { repo: r.root, committed: true, session_id: 's1', commit_refs: [a.slice(0, 7)] });
  const e2 = ep('e2', T0 + 5 * 60000, T0 + 35 * 60000, { repo: r.root, committed: true, session_id: 's2', commit_refs: [b.slice(0, 7)] });
  const [o1, o2] = linkEpisodes([e1, e2], new Map([[r.root, commits]]));
  assert.deepEqual(o1.commits, [a]);
  assert.deepEqual(o2.commits, [b]);
  assert.equal(o1.rework, true);
  assert.equal(o2.rework, false, 'the revert names only e1\'s commit');
  assert.deepEqual(o1.downstream.filter((d) => d.kind === 'revert').map((d) => d.ref), [rv]);
  r.cleanup();
});

test('without session evidence a commit goes to the tightest window; a tie leaves it unattributed', () => {
  const r = makeRepo();
  const c = r.commit(iso(T0 + 10 * 60000), 'feat: c', { 'c.txt': 'c1' });
  const commits = repoCommits(r.root, { since: T0 - H, until: T0 + H });
  const wide = ep('wide', T0, T0 + 50 * 60000, { repo: r.root, committed: true, session_id: 's1' });
  const tight = ep('tight', T0 + 5 * 60000, T0 + 15 * 60000, { repo: r.root, committed: true, session_id: 's2' });
  const [w, t] = linkEpisodes([wide, tight], new Map([[r.root, commits]]));
  assert.deepEqual(w.commits, []);
  assert.deepEqual(t.commits, [c]);
  const twin = ep('twin', T0, T0 + 50 * 60000, { repo: r.root, committed: true, session_id: 's3' });
  const out = linkEpisodes([wide, twin], new Map([[r.root, commits]]));
  assert.deepEqual(out.map((o) => o.commits), [[], []]);
  assert.deepEqual(out.unattributed, [c]);
  r.cleanup();
});

test('rule v3: later-session fix over 1 hour is a candidate; same session or under 1 hour is iteration; no commit, no follow-up', () => {
  const r = makeRepo();
  r.commit(iso(T0 - H), 'base', { 'src/a.js': 'v0', 'src/b.js': 'v0' });
  r.commit(iso(T0 + 10 * 60000), 'feat: parser', { 'src/a.js': 'v1' });
  r.commit(iso(T0 + 40 * 60000), 'fix: quick follow-up', { 'src/a.js': 'v2' });
  r.commit(iso(T0 + 3 * H), 'fix(parser): same session, later', { 'src/a.js': 'v3' });
  r.commit(iso(T0 + 5 * H), 'fix(parser): handle empty input', { 'src/a.js': 'v4' });
  r.commit(iso(T0 + 6 * H), 'Revert the b change', { 'src/b.js': 'v1' });
  const commits = repoCommits(r.root, { since: T0 - 2 * H, until: T0 + 80 * H });
  assert.deepEqual(commits.find((c) => c.subject.startsWith('fix(parser): handle')).files, ['src/a.js']);
  const first = ep('e1', T0, T0 + 15 * 60000, { repo: r.root, committed: true, session_id: 's1' });
  // Same session s1 makes the 40-minute and 3-hour fixes; session s2 makes the 5-hour one.
  const quick = ep('e2', T0 + 35 * 60000, T0 + 41 * 60000, { repo: r.root, committed: true, session_id: 's1' });
  const same = ep('e3', T0 + 3 * H - 60000, T0 + 3 * H + 30000, { repo: r.root, committed: true, session_id: 's1' });
  const later = ep('e4', T0 + 5 * H - 60000, T0 + 5 * H + 30000, { repo: r.root, committed: true, session_id: 's2' });
  const touchedOnly = ep('et', T0, T0 + 15 * 60000, { repo: r.root, touched_files: [`${r.root}/src/b.js`], session_id: 's3' });
  const [a, , , , t] = linkEpisodes([first, quick, same, later, touchedOnly], new Map([[r.root, commits]]));
  assert.deepEqual(a.downstream.map((d) => `${d.kind}:${d.link}`), ['fixup:soft']);
  assert.equal(a.possible_fix, true, 'the 5-hour fix from session s2');
  assert.equal(a.iteration_commits.length, 2, 'the 40-minute and same-session 3-hour fixes');
  assert.equal(a.rework, false, 'no named revert');
  assert.equal(t.rework || t.possible_fix, false, 'no commit, no follow-up');
  r.cleanup();
});
