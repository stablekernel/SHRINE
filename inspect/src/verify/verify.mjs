// Verifier (spec 7): runtime hash check of the files this tool opened. A config
// file that changed while the spy log shows a write open by inspect fails the
// run; any other change is reported as "changed during run, not by inspect".
// Append-only session logs only record growth, attributed to other sessions.
// Each scanned repo's .git is also snapshotted (pack list, index and HEAD mtimes):
// a change there while HEAD did not move can only be inspect's own git calls
// (for example a lazy fetch), so it fails the run.
import { resolve } from 'node:path';
import { exists, list, readBytes, sha256, stat } from '../io/fsread.mjs';
import { gitOut } from '../io/git.mjs';

function gitState(root) {
  const dir = gitOut(['rev-parse', '--absolute-git-dir'], root);
  const commonOut = gitOut(['rev-parse', '--git-common-dir'], root);
  if (!dir || !commonOut) return null;
  const common = resolve(root, commonOut);
  const mtime = (p) => stat(p)?.mtimeMs ?? null;
  const packs = list(resolve(common, 'objects', 'pack')).map((e) => e.name).join('\n');
  return { common, packs, index: mtime(resolve(dir, 'index')), head: mtime(resolve(dir, 'HEAD')) };
}

const sameState = (a, b) => a.packs === b.packs && a.index === b.index && a.head === b.head;

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
      if (after && !sameState(h.git, after)) changed.push({ path: h.git.common, change: '.git changed', by: 'inspect' });
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
