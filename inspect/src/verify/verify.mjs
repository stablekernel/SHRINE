// Verifier (spec 7): runtime hash check of the files this tool opened. A config
// file that changed while the spy log shows a write open by inspect fails the
// run; any other change is reported as "changed during run, not by inspect".
// Append-only session logs only record growth, attributed to other sessions.
// Each scanned repo's .git is also snapshotted (pack list, objects/bundles,
// loose-object folders; index, HEAD, FETCH_HEAD, and packed-refs mtimes). Any
// object written during one of inspect's own git runs in that repo fails the run
// (a lazy fetch, or a bundle URI it applied), unless a pack was removed or
// FETCH_HEAD moved (a user repack or fetch). Index, HEAD, ref, and other object
// changes come from the user (git add, stash, fetch, repack, gc, maintenance, an
// IDE refresh) and are reported as changed by others.
import { resolve, sep } from 'node:path';
import { exists, list, readBytes, sha256, stat } from '../io/fsread.mjs';
import { gitOut } from '../io/git.mjs';

// name -> mtime for the entries of a folder, skipping in-flight tmp_* files.
function entries(dir, keep = () => true) {
  const out = {};
  for (const e of list(dir)) if (!e.name.startsWith('tmp_') && keep(e.name)) out[e.name] = stat(resolve(dir, e.name))?.mtimeMs ?? null;
  return out;
}

function gitState(root) {
  const dir = gitOut(['rev-parse', '--absolute-git-dir'], root);
  const commonOut = gitOut(['rev-parse', '--git-common-dir'], root);
  if (!dir || !commonOut) return null;
  const common = resolve(root, commonOut);
  const mtime = (p) => stat(p)?.mtimeMs ?? null;
  const objects = resolve(common, 'objects');
  return {
    common,
    // tmp_* entries are packs still being written by some other git process.
    packs: entries(resolve(objects, 'pack')),
    bundles: entries(resolve(objects, 'bundles')),
    // Loose objects land in two-hex-digit folders; a new object bumps the folder mtime.
    loose: entries(objects, (n) => /^[0-9a-f]{2}$/.test(n)),
    bundles_dir: mtime(resolve(objects, 'bundles')),
    index: mtime(resolve(dir, 'index')),
    head: mtime(resolve(dir, 'HEAD')),
    fetch_head: mtime(resolve(common, 'FETCH_HEAD')),
    refs: mtime(resolve(common, 'packed-refs')),
  };
}

const OBJECT_KEYS = ['packs', 'bundles', 'loose'];
const sameMap = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameState = (a, b) => OBJECT_KEYS.every((k) => sameMap(a[k], b[k])) && ['bundles_dir', 'index', 'head', 'fetch_head', 'refs'].every((k) => a[k] === b[k]);
// Slack around each inspect git run for clock and timestamp jitter.
const SLACK_MS = 250;
// Coarse filesystems truncate mtimes to the second (HFS+, NFS, some ext4) or to
// two seconds (FAT, exFAT), so a pack written during a run can carry an mtime
// before the run's start. The low bound drops to the start of the run's second,
// or of its two-second slot when the mtime itself is a whole second.
function inRun(m, r) {
  const grain = m % 1000 === 0 ? 2000 : 1000;
  return m >= Math.floor(r.t_start / grain) * grain - SLACK_MS && m <= r.t + SLACK_MS;
}
// A lazy fetch (or the bundle URI it applies first) adds objects and never writes
// FETCH_HEAD; a repack or gc also removes packs. The user or an IDE can fetch in
// the same clone, so inspect is blamed only when a new or touched object entry's
// mtime falls inside one of its own git runs in that repo.
function objectsWritten(a, b, runs) {
  if (a.fetch_head !== b.fetch_head) return false;
  if (Object.keys(a.packs).some((n) => !(n in b.packs))) return false;
  const touched = OBJECT_KEYS.flatMap((k) => Object.entries(b[k]).filter(([n, m]) => a[k][n] !== m).map(([, m]) => m));
  if (b.bundles_dir !== a.bundles_dir) touched.push(b.bundles_dir);
  return touched.some((m) => m != null && runs.some((r) => inRun(m, r)));
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
      if (after && !sameState(h.git, after)) changed.push({ path: h.git.common, change: '.git changed', by: objectsWritten(h.git, after, gitRunsIn(spy, resolve(h.root))) ? 'inspect' : 'others' });
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
