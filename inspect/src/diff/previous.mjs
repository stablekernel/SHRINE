// Previous-run diff (spec 1): new, cleared, unchanged finding ids vs the last run.
import { join } from 'node:path';
import { exists, list, readJson } from '../io/fsread.mjs';

export function diffRuns(prev, cur) {
  if (!prev) return null;
  const before = new Set(prev.findings.map((f) => f.id));
  const now = new Set(cur.findings.map((f) => f.id));
  let added = 0;
  let unchanged = 0;
  for (const id of now) (before.has(id) ? unchanged++ : added++);
  const cleared = [...before].filter((id) => !now.has(id)).length;
  return { new: added, cleared, unchanged };
}

export function previousFindings(stateDir, currentRunId) {
  const runs = join(stateDir, 'runs');
  const ids = list(runs)
    .filter((e) => e.dir && e.name !== currentRunId && e.name < currentRunId)
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const id of ids) {
    const p = join(runs, id, 'findings.json');
    if (exists(join(runs, id, 'findings.done')) && exists(p)) return readJson(p);
  }
  return null;
}

export function diffLine(d) {
  return d ? `new ${d.new}, cleared ${d.cleared}, unchanged ${d.unchanged}` : '';
}
