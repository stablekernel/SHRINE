// Verifier (spec 7): runtime hash check of the files this tool opened. A config
// file that changed while the spy log shows a write open by inspect fails the
// run; any other change is reported as "changed during run, not by inspect".
// Append-only session logs only record growth, attributed to other sessions.
// Each scanned repo's .git is also snapshotted (pack list; index, HEAD, FETCH_HEAD,
// and packed-refs mtimes). Only the lazy-fetch signature fails the run: a new
// promisor pack written during one of inspect's own git runs in that repo, no pack
// removed, and no FETCH_HEAD update. Index, HEAD, ref, and
// other pack changes come from the user (git add, stash, fetch, repack, gc,
// maintenance, an IDE refresh) and are reported as changed by others.
import { resolve, sep } from 'node:path';
import { exists, list, readBytes, sha256, stat } from '../io/fsread.mjs';
import { gitOut } from '../io/git.mjs';

function gitState(root) {
  const dir = gitOut(['rev-parse', '--absolute-git-dir'], root);
  const commonOut = gitOut(['rev-parse', '--git-common-dir'], root);
  if (!dir || !commonOut) return null;
  const common = resolve(root, commonOut);
  const mtime = (p) => stat(p)?.mtimeMs ?? null;
  // tmp_* entries are packs still being written by some other git process.
  const packs = list(resolve(common, 'objects', 'pack'))
    .map((e) => e.name)
    .filter((n) => !n.startsWith('tmp_'))
    .sort()
    .join('\n');
  return {
    common,
    packs,
    index: mtime(resolve(dir, 'index')),
    head: mtime(resolve(dir, 'HEAD')),
    fetch_head: mtime(resolve(common, 'FETCH_HEAD')),
    refs: mtime(resolve(common, 'packed-refs')),
  };
}

const sameState = (a, b) => ['packs', 'index', 'head', 'fetch_head', 'refs'].every((k) => a[k] === b[k]);
// Slack around each inspect git run for coarse filesystem mtimes.
const SLACK_MS = 250;
// A lazy fetch only adds a pack with a .promisor sidecar and never writes
// FETCH_HEAD. A repack or gc also removes packs; plain fetches add no .promisor.
// The user or an IDE can lazy-fetch in the same clone, so inspect is blamed only
// when the new pack's mtime falls inside one of its own git runs in that repo.
function lazyFetch(a, b, runs) {
  if (a.fetch_head !== b.fetch_head) return false;
  const before = new Set(a.packs.split('\n'));
  const after = new Set(b.packs.split('\n'));
  if ([...before].some((n) => n && !after.has(n))) return false;
  return [...after]
    .filter((n) => n.endsWith('.promisor') && !before.has(n))
    .map((n) => stat(resolve(a.common, 'objects', 'pack', n))?.mtimeMs)
    .some((m) => m != null && runs.some((r) => m >= r.t_start - SLACK_MS && m <= r.t + SLACK_MS));
}

function gitRunsIn(spy, root) {
  const under = (cwd) => cwd && (resolve(cwd) === root || resolve(cwd).startsWith(`${root}${sep}`));
  return spy.filter((e) => e.op === 'spawn' && e.cmd === 'git' && e.t_start != null && under(e.cwd));
}

export function baselineOf(items, repos = []) {
  const files = items
    .filter((i) => !i.virtual && i.sha256)
    .map((i) => ({ path: i.path, sha256: i.sha256, size: i.bytes, mtime_ms: i.mtime_ms ?? null, append_only: i.path.endsWith('.jsonl') }));
  const heads = repos.map((root) => ({ root, head: gitOut(['rev-parse', 'HEAD'], root), git: gitState(root) }));
  return { files, heads };
}

export function verifyRun(baseline, spy) {
  const writes = new Set(spy.filter((e) => e.op === 'write' || (e.mode && e.mode !== 'r' && e.op !== 'spawn')).map((e) => e.path));
  const changed = [];
  for (const f of baseline.files) {
    const s = stat(f.path);
    if (!s) {
      changed.push({ path: f.path, change: 'removed', by: writes.has(f.path) ? 'inspect' : 'others' });
      continue;
    }
    if (f.append_only) {
      if (s.size !== f.size) changed.push({ path: f.path, change: 'grew', by: 'others' });
      continue;
    }
    if (s.size === f.size && (f.mtime_ms === null || s.mtimeMs === f.mtime_ms)) continue;
    if (sha256(readBytes(f.path)) === f.sha256) continue;
    changed.push({ path: f.path, change: 'modified', by: writes.has(f.path) ? 'inspect' : 'others' });
  }
  for (const h of baseline.heads) {
    if (!exists(h.root)) continue;
    const now = gitOut(['rev-parse', 'HEAD'], h.root);
    if (now !== h.head) changed.push({ path: h.root, change: 'HEAD moved', by: 'others' });
    else if (h.git) {
      const after = gitState(h.root);
      if (after && !sameState(h.git, after)) changed.push({ path: h.git.common, change: '.git changed', by: lazyFetch(h.git, after, gitRunsIn(spy, resolve(h.root))) ? 'inspect' : 'others' });
    }
  }
  const byInspect = changed.filter((c) => c.by === 'inspect');
  const badSpawns = spy.filter((e) => e.op === 'spawn' && e.cmd !== 'git' && e.cmd !== process.execPath);
  return {
    ok: byInspect.length === 0 && badSpawns.length === 0,
    changed_paths: byInspect.map((c) => c.path),
    changed_by_others: changed.filter((c) => c.by === 'others').map((c) => ({ path: c.path, change: c.change, note: 'changed during run, not by inspect' })),
    files_checked: baseline.files.length,
    spawns: spy.filter((e) => e.op === 'spawn').length,
    excluded_session_ids: [],
  };
}
