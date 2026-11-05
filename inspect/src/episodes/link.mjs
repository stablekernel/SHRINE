// Minimal git linker for T0 (spec 4 outcome anchors, plan T2.7), rework rule v3:
// - rework: a later commit within 72 hours whose body names one of the
//   episode's commits ("This reverts commit <sha>"). Only this is a headline count.
// - possible rework (later-session fix): a fix, revert, fixup, or squash commit on
//   a file of the episode's commits (or a fixup naming one of them), from a later session and at least 1 hour
//   after the episode's last commit. A candidate count.
// - iteration: the same kind of follow-up in the same session or under 1 hour.
//   Normal work; counted apart, never as rework.
// - possible rework (file overlap): a later episode touching the same file. A
//   candidate count.
// Amended commits leave history, so they are never counted.
import { git } from '../io/git.mjs';
import { isDir } from '../io/fsread.mjs';

const RS = '\x1e';
const US = '\x1f';
const HOUR = 3600000;
const MAX_LINKS = 5;
// Commits up to this long after the episode's last event still belong to it.
const COMMIT_SLACK_MS = 2 * 60000;

// Why a git log run gave no history: null when it worked or the folder has no
// history to read (gone, or not a repo); else 'timed out', 'not owned' (git
// refused a repo another user owns), or 'failed' (any other non-zero exit).
function logFailure(r, root) {
  if (r.ok) return null;
  if (r.timedOut) return 'timed out';
  if (!isDir(root) || /not a git repository/i.test(r.stderr)) return null;
  return /dubious ownership/i.test(r.stderr) ? 'not owned' : 'failed';
}

// Commits on any ref with commit time in [since, until] (ms). Empty when the
// folder is gone or not a repo. When git ran and failed, { failed: reason } (see
// logFailure): that is history not read, never "no commits".
// Bodies are read only for revert commits (a second, filtered log), so a busy
// repo never pushes the output past the spawn buffer.
export function repoCommits(root, { since, until }) {
  const range = ['--all', '--no-merges', `--since=@${Math.floor(since / 1000)}`, `--until=@${Math.ceil(until / 1000)}`];
  const log = (args) => {
    try {
      return git(['log', ...range, ...args], { cwd: root });
    } catch (e) {
      if (e.code === 'E_GIT_DENIED') throw e;
      return { ok: false, stdout: '', stderr: String(e.message ?? e) };
    }
  };
  const r = log(['--no-renames', '--name-only', `--format=${RS}%H${US}%ct${US}%ae${US}%s${US}`]);
  const failed = logFailure(r, root);
  if (failed) return { failed };
  const out = r.ok ? r.stdout.trim() : '';
  if (!out) return [];
  const reverts = new Map();
  const rr = log(['--grep=This reverts commit', `--format=${RS}%H${US}%b`]);
  const rvFailed = logFailure(rr, root);
  if (rvFailed) return { failed: rvFailed };
  const rv = rr.ok ? rr.stdout.trim() : '';
  for (const rec of rv.split(RS).filter(Boolean)) {
    const [sha, body] = rec.split(US);
    reverts.set(sha.trim(), body ?? '');
  }
  return out
    .split(RS)
    .filter(Boolean)
    .map((rec) => {
      const [sha, ct, author, subject, names] = rec.split(US);
      const id = sha.trim();
      const files = (names ?? '').split('\n').map((f) => f.trim()).filter(Boolean);
      return { sha: id, t: Number(ct) * 1000, author: (author ?? '').trim().toLowerCase(), subject: (subject ?? '').trim(), body: reverts.get(id) ?? '', files };
    });
}

const hours = (ms) => Math.round((ms / HOUR) * 10) / 10;

// episodes: [{id, repo, start, end, committed, touched_files}]; commitsByRepo:
// Map(root -> repoCommits()). Returns copies with commits, downstream, rework
// (reverts and fixes only), and possible_rework (file overlap only).
export function linkEpisodes(episodes, commitsByRepo, { windowHours = 72 } = {}) {
  const win = windowHours * HOUR;
  const ms = (e) => ({ s: Date.parse(e.start), e: Date.parse(e.end) });
  // Per repo, episodes sorted by start: each episode scans forward only while the
  // next start is inside the window, never the whole history.
  const byRepo = new Map();
  for (const e of episodes) {
    if (!byRepo.has(e.repo)) byRepo.set(e.repo, []);
    byRepo.get(e.repo).push({ ep: e, s: Date.parse(e.start) });
  }
  for (const list of byRepo.values()) list.sort((a, b) => a.s - b.s);
  const lowerBound = (list, x) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Pass 1: each commit has at most one owner episode, and which session made it.
  const ownOf = new Map(episodes.map((ep) => [ep, []]));
  const sessionOfCommit = new Map();
  const sessionEnd = new Map();
  const unattributed = [];
  for (const ep of episodes) sessionEnd.set(ep.session_id, Math.max(sessionEnd.get(ep.session_id) ?? 0, ms(ep).e));
  for (const [repo, commits] of commitsByRepo) {
    for (const [c, ep] of attribute(commits, episodes.filter((x) => x.repo === repo && x.committed), ms, unattributed)) {
      ownOf.get(ep).push(c);
      sessionOfCommit.set(c.sha, ep.session_id);
    }
  }
  for (const own of ownOf.values()) own.sort((a, b) => b.t - a.t);
  const out = episodes.map((ep) => {
    const { e } = ms(ep);
    const commits = commitsByRepo.get(ep.repo) ?? [];
    const own = ownOf.get(ep);
    const lastOwn = own.reduce((m, c) => Math.max(m, c.t), 0);
    const links = [];
    const iteration = [];
    const revertRes = own.map((o) => new RegExp(`This reverts commit ${o.sha.slice(0, 7)}`));
    const changed = new Set(own.flatMap((c) => c.files ?? []));
    for (const c of own.length ? commits : []) {
      const d = c.t - e;
      if (d <= 0 || d > win || own.includes(c)) continue;
      if (revertRes.some((re) => re.test(c.body))) {
        links.push({ kind: 'revert', ref: c.sha, delta_hours: hours(d), link: 'hard' });
        continue;
      }
      // A fixup or squash naming one of its commits needs no file match.
      const named = c.subject.match(/^(?:fixup|squash|amend)! (.+)$/);
      const namesOwn = named && own.some((o) => o.subject === named[1]);
      const fixOnFiles = /^(fix|revert)\b/i.test(c.subject) && (c.files ?? []).some((f) => changed.has(f));
      if (!namesOwn && !fixOnFiles) continue;
      const by = sessionOfCommit.get(c.sha);
      // A commit no episode made counts as a later session once this session has ended.
      const laterSession = by ? by !== ep.session_id : c.t > (sessionEnd.get(ep.session_id) ?? e);
      if (laterSession && c.t - lastOwn >= HOUR) links.push({ kind: 'fixup', ref: c.sha, delta_hours: hours(d), link: 'soft' });
      else iteration.push(c.sha);
    }
    const files = new Set(ep.touched_files ?? []);
    if (files.size) {
      const list = byRepo.get(ep.repo);
      for (let i = lowerBound(list, e); i < list.length && list[i].s - e <= win; i++) {
        const other = list[i].ep;
        if (other === ep) continue;
        if ((other.touched_files ?? []).some((f) => files.has(f))) links.push({ kind: 'episode', ref: other.id, delta_hours: hours(list[i].s - e), link: 'soft' });
      }
    }
    links.sort((a, b) => a.delta_hours - b.delta_hours || a.ref.localeCompare(b.ref));
    return {
      ...ep,
      commits: own.map((c) => c.sha),
      downstream: links.slice(0, MAX_LINKS),
      rework: links.some((l) => l.kind === 'revert'),
      possible_fix: links.some((l) => l.kind === 'fixup'),
      possible_rework: links.some((l) => l.kind === 'episode'),
      // Shas, so a fix commit following several episodes is counted once.
      iteration_commits: iteration,
    };
  });
  // Commits inside two or more equally tight windows: owned by no episode.
  out.unattributed = unattributed;
  return out;
}

// Map(commit -> owner episode). A repo root collects every worktree and every
// fetched ref, so a time window alone over-claims. Order of evidence:
// 1. the sha the session's own commit command printed (commit_refs);
// 2. else, when the sessions printed any shas, only commits by those authors;
//    episodes that printed shas claim nothing more by window;
// 3. else the tightest window holding the commit; a tie is unattributed.
function attribute(commits, eps, ms, unattributed) {
  const owner = new Map();
  if (!eps.length || !commits.length) return owner;
  const byPrefix = new Map();
  for (const ep of eps) {
    for (const ref of ep.commit_refs ?? []) {
      const k = ref.slice(0, 7);
      if (!byPrefix.has(k)) byPrefix.set(k, []);
      byPrefix.get(k).push({ ep, ref });
    }
  }
  const authors = new Set();
  for (const c of commits) {
    const hit = (byPrefix.get(c.sha.slice(0, 7)) ?? []).find((x) => c.sha.startsWith(x.ref));
    if (!hit) continue;
    owner.set(c, hit.ep);
    if (c.author) authors.add(c.author);
  }
  const sorted = [...commits].sort((a, b) => a.t - b.t);
  const firstAtOrAfter = (x) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].t < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const candidates = new Map();
  for (const ep of eps) {
    if (ep.commit_refs?.length) continue;
    const { s, e } = ms(ep);
    for (let i = firstAtOrAfter(s - 1000); i < sorted.length && sorted[i].t <= e + COMMIT_SLACK_MS; i++) {
      const c = sorted[i];
      if (owner.has(c) || (authors.size && !authors.has(c.author))) continue;
      if (!candidates.has(c)) candidates.set(c, []);
      candidates.get(c).push({ ep, span: e - s });
    }
  }
  for (const [c, list] of candidates) {
    const min = Math.min(...list.map((x) => x.span));
    const tight = list.filter((x) => x.span === min);
    if (tight.length === 1) owner.set(c, tight[0].ep);
    else unattributed.push(c.sha);
  }
  return owner;
}
