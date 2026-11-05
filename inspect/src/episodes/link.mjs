// Minimal git linker for T0 (spec 4 outcome anchors, plan T2.7). Links an
// episode to later rework within 72 hours: reverts of its commits by SHA, fixup
// or squash commits naming them, and later episodes that touch the same file.
// Amended commits leave history, so they are never counted.
import { gitOut } from '../io/git.mjs';

const RS = '\x1e';
const US = '\x1f';
const HOUR = 3600000;
const MAX_LINKS = 5;
// Commits up to this long after the episode's last event still belong to it.
const COMMIT_SLACK_MS = 2 * 60000;

// Commits on any ref with commit time in [since, until] (ms). Empty when the
// folder is gone or not a repo.
export function repoCommits(root, { since, until }) {
  const out = gitOut(
    ['log', '--all', '--no-merges', `--since=@${Math.floor(since / 1000)}`, `--until=@${Math.ceil(until / 1000)}`, `--format=${RS}%H${US}%ct${US}%s${US}%b${US}`],
    root,
  );
  if (!out) return [];
  return out
    .split(RS)
    .filter(Boolean)
    .map((rec) => {
      const [sha, ct, subject, body] = rec.split(US);
      return { sha, t: Number(ct) * 1000, subject: subject ?? '', body: body ?? '' };
    });
}

const hours = (ms) => Math.round((ms / HOUR) * 10) / 10;

// episodes: [{id, repo, start, end, committed, touched_files}]; commitsByRepo:
// Map(root -> repoCommits()). Returns copies with commits, downstream, rework.
export function linkEpisodes(episodes, commitsByRepo, { windowHours = 72 } = {}) {
  const win = windowHours * HOUR;
  const ms = (e) => ({ s: Date.parse(e.start), e: Date.parse(e.end) });
  return episodes.map((ep) => {
    const { s, e } = ms(ep);
    const commits = commitsByRepo.get(ep.repo) ?? [];
    const own = ep.committed ? commits.filter((c) => c.t >= s - 1000 && c.t <= e + COMMIT_SLACK_MS) : [];
    const ownSubjects = new Set(own.map((c) => c.subject));
    const links = [];
    for (const c of commits) {
      const d = c.t - e;
      if (d <= 0 || d > win || own.includes(c)) continue;
      const reverts = own.some((o) => new RegExp(`This reverts commit ${o.sha.slice(0, 7)}`).test(c.body));
      const fix = c.subject.match(/^(fixup|squash|amend)! (.+)$/);
      if (reverts) links.push({ kind: 'revert', ref: c.sha, delta_hours: hours(d), link: 'hard' });
      else if (fix && ownSubjects.has(fix[2])) links.push({ kind: 'fixup', ref: c.sha, delta_hours: hours(d), link: 'hard' });
    }
    const files = new Set(ep.touched_files ?? []);
    if (files.size) {
      for (const other of episodes) {
        if (other === ep || other.repo !== ep.repo) continue;
        const d = ms(other).s - e;
        if (d <= 0 || d > win) continue;
        if ((other.touched_files ?? []).some((f) => files.has(f))) links.push({ kind: 'episode', ref: other.id, delta_hours: hours(d), link: 'soft' });
      }
    }
    links.sort((a, b) => a.delta_hours - b.delta_hours || a.ref.localeCompare(b.ref));
    return { ...ep, commits: own.map((c) => c.sha), downstream: links.slice(0, MAX_LINKS), rework: links.length > 0 };
  });
}
