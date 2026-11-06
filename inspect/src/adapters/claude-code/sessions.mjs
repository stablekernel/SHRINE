// Own-session exclusion (spec 7, plan T2.6). The session driving this run is
// never scanned: the id from --session-id when given, else the newest session
// file that is still growing (written within the last 5 minutes). Decided from
// file metadata only, so Gate A can name it before any history is read.
import { basename } from 'node:path';

export const GROWING_MS = 5 * 60000;

// listing: listProjects() result. Returns {id, project, reason} or null.
export function ownSession(listing, { sessionId = null, now = Date.now() } = {}) {
  const files = listing.projects.flatMap((p) => (p.files ?? []).map((f) => ({ ...f, project: p.name })));
  if (sessionId) {
    const f = files.find((x) => basename(x.path, '.jsonl') === sessionId);
    return { id: sessionId, project: f?.project ?? null, reason: 'flag' };
  }
  const newest = files.sort((a, b) => b.mtime - a.mtime)[0];
  // A file dated after now (clock skew, a pinned test clock) is not growing.
  if (!newest || newest.mtime > now || now - newest.mtime > GROWING_MS) return null;
  return { id: basename(newest.path, '.jsonl'), project: newest.project, reason: 'growing' };
}

export const excludeSessions = (sessions, ids) => sessions.filter((s) => !ids.includes(s.id));
