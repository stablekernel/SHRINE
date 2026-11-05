// Episode sampler for T1 (spec 4, plan T1 task 1). Seeded and stratified: the
// same seed and episodes give a byte-identical sample.json. Pure; no IO.
//
// Pool: episodes with at least 1 correction candidate (code flag), from sessions
// that are not the run's own and not automation (housekeeping, spawned, or
// unattributed sdk-cli sessions never reach the episode list; excluded ids are
// dropped again here). Resends are already dropped by the reader.
// Strata: recency thirds of the window (newest, middle, oldest), an equal share
// each. At most `per_project` episodes per project while other projects can fill
// the sample; past that the cap is relaxed and the sample says so.
// Weight: 3x for episodes from sessions with 2 or more correction candidates,
// drawn by weighted keys (u ^ (1 / w), highest first).
import { mulberry32 } from './prng.mjs';

export const SAMPLE_VERSION = 1;
const STRATA = ['newest', 'middle', 'oldest'];
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function drawSample({ episodes, seed, size = 12, perProject = 4, weight = 3, sessionMin = 2, thinTotal = 20, excludeSessionIds = [] }) {
  if (!Number.isInteger(seed)) throw new Error('drawSample needs an integer seed');
  const excluded = new Set(excludeSessionIds);
  const all = episodes.filter((e) => !excluded.has(e.session_id));
  const corrections = (e) => (Number.isInteger(e.flags?.corrections) ? e.flags.corrections : 0);
  const perSession = new Map();
  for (const e of all) perSession.set(e.session_id, (perSession.get(e.session_id) ?? 0) + corrections(e));
  const pool = all.filter((e) => corrections(e) >= 1).sort(byId);

  // One draw per pool episode, in id order, so the keys depend only on the seed and the pool.
  const rnd = mulberry32(seed);
  const keyed = pool.map((e) => {
    const w = (perSession.get(e.session_id) ?? 0) >= sessionMin ? weight : 1;
    const u = rnd() || Number.MIN_VALUE;
    return { e, w, key: u ** (1 / w) };
  });
  const order = (xs) => [...xs].sort((a, b) => b.key - a.key || byId(a.e, b.e));

  const picked = new Set();
  const perProj = new Map();
  const project = (e) => e.stratum?.project ?? e.project ?? '';
  const take = (k, capped) => {
    if (picked.has(k.e.id)) return false;
    if (capped && (perProj.get(project(k.e)) ?? 0) >= perProject) return false;
    picked.add(k.e.id);
    perProj.set(project(k.e), (perProj.get(project(k.e)) ?? 0) + 1);
    return true;
  };
  // Equal quota per recency third; the remainder goes to the newest first.
  const quota = STRATA.map((_, i) => Math.floor(size / 3) + (i < size % 3 ? 1 : 0));
  STRATA.forEach((s, i) => {
    let n = 0;
    for (const k of order(keyed.filter((x) => (x.e.stratum?.recency ?? 'newest') === s))) {
      if (n >= quota[i] || picked.size >= size) break;
      if (take(k, true)) n++;
    }
  });
  // A thin stratum leaves room: fill from the whole pool, still capped per project.
  for (const k of order(keyed)) {
    if (picked.size >= size) break;
    take(k, true);
  }
  // Only when the cap itself blocks a full sample is it relaxed (one dominant project).
  let capRelaxed = false;
  for (const k of order(keyed)) {
    if (picked.size >= size) break;
    if (take(k, false)) capRelaxed = true;
  }

  const chosen = pool.filter((e) => picked.has(e.id)).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : byId(a, b)));
  const count = (key) => Object.fromEntries([...new Set(chosen.map(key))].sort().map((k) => [k, chosen.filter((e) => key(e) === k).length]));
  return {
    schema_version: SAMPLE_VERSION,
    seed,
    size,
    total_episodes: all.length,
    eligible: pool.length,
    // Fewer eligible episodes than the sample size: all are taken, labelled thin evidence.
    thin: pool.length < size,
    // Fewer than 20 episodes in all: T1 at most, no control, no outcome praise (spec 4 rule 3).
    small_history: all.length < thinTotal,
    cap_relaxed: capRelaxed,
    episode_ids: chosen.map((e) => e.id),
    strata: count((e) => e.stratum?.recency ?? 'newest'),
    projects: Object.keys(count(project)).length,
  };
}
