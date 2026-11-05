// Episode transcripts for T1 evidence packs (plan T1 task 2). Re-reads only the
// sessions holding sampled episodes, in detail mode, and slices each episode's
// main-thread events by its root human turn and end time. Every text in the
// result was scrubbed by the reader; masking happens in the bundle builder.
import { readSession } from './events.mjs';

// Events of one episode: from its root human turn (matched by uuid, else by start
// time) through its end time. Subagent events are left out. The live config is
// the newest instruction snapshot at or before the episode start, else the first
// one in the session (loaded at start, before the first prompt was logged).
export function sliceEpisode(timeline, ep) {
  const main = timeline.filter((e) => !e.sub);
  let from = main.findIndex((e) => e.kind === 'human' && e.uuid && e.uuid === ep.root_turn_id);
  if (from < 0) from = main.findIndex((e) => e.kind === 'human' && e.t === ep.start);
  if (from < 0) return null;
  const events = [];
  for (let i = from; i < main.length; i++) {
    const e = main[i];
    if (e.t && e.t > ep.end) break;
    if (e.kind === 'instructions') continue;
    events.push(e);
  }
  const snaps = main.filter((e) => e.kind === 'instructions');
  const before = snaps.filter((e) => e.t && e.t <= ep.start).at(-1);
  if (before) return { events, snapshot: before.files, snapshot_late: false };
  // A snapshot logged after the episode started may hold files loaded later on, so
  // it is used only as "may have changed", which caps attribution at unknown.
  const later = snaps[0] ?? null;
  return { events, snapshot: later ? later.files : null, snapshot_late: Boolean(later) };
}

// metas: session metas by id ({id, path, subagent_files}); episodes: sampled facts
// episodes. Returns Map(episode id -> {events, snapshot}); an episode whose
// session cannot be read or whose root turn is gone maps to null.
export async function episodeTranscripts(metas, episodes) {
  const out = new Map();
  const bySession = new Map();
  for (const ep of episodes) bySession.set(ep.session_id, [...(bySession.get(ep.session_id) ?? []), ep]);
  for (const [sid, eps] of bySession) {
    const meta = metas.get(sid);
    const r = meta ? await readSession(meta, { detail: true }) : null;
    for (const ep of eps) out.set(ep.id, r && r.kind === 'session' ? sliceEpisode(r.timeline, ep) : null);
  }
  return out;
}
