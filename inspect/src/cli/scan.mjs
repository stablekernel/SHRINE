// History scan for T0 (spec 3 phases 2, 4, 5; plan T2.10). Runs only after
// Gate A says yes: reads the consented session logs by streaming, normalizes
// events, cuts episodes, links git outcomes, and runs the usage probes. Nothing
// here calls a model or opens a socket.
import { linkSpawned, sessionInventory } from '../adapters/claude-code/projects.mjs';
import { excludeSessions } from '../adapters/claude-code/sessions.mjs';
import { readSession } from '../adapters/claude-code/events.mjs';
import { extractEpisodes } from '../episodes/extract.mjs';
import { historyReadable, isHung } from '../io/git.mjs';
import { linkEpisodes, repoCommits } from '../episodes/link.mjs';
import { runUsageProbes } from '../probes/usage.mjs';
import { historyRule } from '../scorer/stats.mjs';
import { THRESHOLDS } from '../probes/config.mjs';

const HOUR = 3600000;
// Loops, not spread: spread arguments overflow the stack on very long arrays.
const minOf = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
const maxOf = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

// Seconds to parse `bytes` at the measured E2 rate; a lower bound (episodes and
// git links add time).
export function estimateSeconds(bytes, t = THRESHOLDS) {
  return Math.ceil(bytes / (t.history.parse_mb_per_second * 1024 * 1024));
}

// UTC clock time; the report labels the timeline as UTC.
const hhmm = (iso) => `${iso.slice(11, 16)} UTC`;

// Generic labels only: no prompt text ever reaches the timeline.
export function episodeTimeline(ep, flags) {
  const ev = [{ at: ep.start, t: hhmm(ep.start), label_scrubbed: 'Prompt', kind: 'neutral', event_kind: 'Prompt' }];
  if (ep.correction_t) ev.push({ at: ep.correction_t, t: hhmm(ep.correction_t), label_scrubbed: 'Correction', kind: 'warn', event_kind: 'Correction' });
  if (flags.done_claim && ep.last_text_t) ev.push({ at: ep.last_text_t, t: hhmm(ep.last_text_t), label_scrubbed: 'Done claim', kind: flags.tested ? 'neutral' : 'warn', event_kind: 'Done claim' });
  if (ep.terminal === 'commit' || ep.terminal === 'pr') ev.push({ at: ep.end, t: hhmm(ep.end), label_scrubbed: 'Commit', kind: 'resolve', event_kind: 'Commit' });
  // Sort on the full timestamp: HH:MM text sorts wrong across midnight.
  return ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(({ at, ...e }) => e);
}

const sizeOf = (tokens) => (tokens < 20000 ? 'small' : tokens < 100000 ? 'medium' : 'large');

function recencyOf(start, from, to) {
  const span = Math.max(1, to - from);
  const x = (Date.parse(start) - from) / span;
  return x >= 2 / 3 ? 'newest' : x >= 1 / 3 ? 'middle' : 'oldest';
}

// listing: listProjects(); excludedIds: own session ids. display: path scrubber.
export async function scanHistory({ listing, excludedIds = [], display = (p) => p, t = THRESHOLDS, onProgress = () => {} }) {
  const inv = sessionInventory(listing);
  const metas = excludeSessions(inv.sessions, excludedIds);
  const sessions = [];
  const episodes = [];
  const skipped = [];
  const roots = new Map();
  let readable = 0;
  for (const [i, meta] of metas.entries()) {
    const r = await readSession(meta);
    for (const f of r.files) {
      if (f.kind === 'unreadable' || f.kind === 'core_missing') skipped.push({ path_scrubbed: display(f.path), reason: f.kind === 'unreadable' ? 'could not be read' : 'core keys missing' });
    }
    onProgress(i + 1, metas.length);
    if (r.kind !== 'session') continue;
    readable++;
    sessions.push(r.session);
    roots.set(r.session.id, meta.root);
    for (const ep of extractEpisodes(r.session, r.timeline, { idleMinutes: t.history.idle_minutes })) episodes.push({ ...ep, repo: meta.root });
  }

  // Git outcome links, one log per repo over the episode span plus the link window.
  // A repo whose history is skipped (partial clone, unsafe git) or whose git log
  // failed (timed out, refused, non-zero exit) has no commits to link: its
  // episodes are marked so the usage counts leave them out.
  const commitsByRepo = new Map();
  const unread = { skipped_episodes: 0, failed: [] };
  const markUnread = (root) => {
    let n = 0;
    for (const e of episodes) {
      if (e.repo !== root) continue;
      e.history_unread = true;
      if (e.committed) n++;
    }
    return n;
  };
  for (const root of new Set(episodes.filter((e) => e.committed).map((e) => e.repo))) {
    // Per repo, so a project folder below a hung repo's root is caught too.
    if (isHung(root)) {
      unread.failed.push({ path_scrubbed: display(root), reason: 'timed out', episodes: markUnread(root) });
      continue;
    }
    if (!historyReadable(root)) {
      unread.skipped_episodes += markUnread(root);
      continue;
    }
    const mine = episodes.filter((e) => e.repo === root);
    const since = minOf(mine.map((e) => Date.parse(e.start)));
    const until = maxOf(mine.map((e) => Date.parse(e.end))) + t.history.link_hours * HOUR;
    const commits = repoCommits(root, { since, until });
    if (Array.isArray(commits)) commitsByRepo.set(root, commits);
    else unread.failed.push({ path_scrubbed: display(root), reason: commits.failed, episodes: markUnread(root) });
  }
  // Spawned sdk-cli work: a byproduct of the parent session, never judged.
  const spawn = linkSpawned(inv.spawned, sessions.map((x) => ({ id: x.id, root: roots.get(x.id), start: x.start, end: x.end })));
  for (const x of sessions) x.byproducts = spawn.parents.get(x.id) ?? 0;
  const automation = { ...inv.automation, spawned_linked: spawn.linked, spawned_parents: spawn.parents.size, unattributed: spawn.unattributed };
  const linked = linkEpisodes(episodes, commitsByRepo, { windowHours: t.history.link_hours });
  const probes = runUsageProbes({ sessions, episodes: linked, t });
  const rule = historyRule({ consented: true, sessions: sessions.length }, t);

  const from = sessions.length ? minOf(sessions.map((s) => Date.parse(s.start))) : 0;
  const to = sessions.length ? maxOf(sessions.map((s) => Date.parse(s.end))) : 0;
  const factsEpisodes = linked.map((e) => {
    const flags = probes.flags.get(e.id);
    return {
      id: e.id,
      session_id: e.session_id,
      root_turn_id: e.root_turn_id,
      start: e.start,
      end: e.end,
      terminal: e.terminal,
      human_turns: e.human_turns,
      assistant_turns: e.assistant_turns,
      interrupts: e.interrupts,
      permission_answers: 0,
      tokens: e.tokens,
      subagents: e.subagents,
      compactions: e.compactions,
      touched_files: e.touched_files.map(display),
      commits: e.commits,
      stratum: { recency: recencyOf(e.start, from, to), project: e.project, size: sizeOf(e.tokens), outcome: e.rework ? 'rework' : e.possible_fix ? 'possible_fix' : e.possible_rework ? 'possible_rework' : 'none' },
      downstream: e.downstream,
      live_config_refs: [],
      timeline: episodeTimeline(e, flags),
      excerpts: { root_prompt_scrubbed: null, corrections_scrubbed: [] },
      flags: { done_claim: flags.done_claim, tested: flags.tested, corrections: flags.corrections, retries: flags.retries },
    };
  });
  const byId = new Map(factsEpisodes.map((e) => [e.id, e]));
  for (const k of probes.kinds) {
    const first = k.episode_ids.map((id) => byId.get(id)).find(Boolean);
    if (first) k.episode_ref = { episode_id: first.id, timeline: first.timeline };
  }
  return {
    inventory: inv,
    sessions,
    roots,
    episodes: factsEpisodes,
    skipped_files: skipped,
    // Repos whose commit history was not read: committed-episode counts for
    // partial clones skipped, and each repo where git log failed, with why.
    git_unread: unread,
    unsupported: metas.length > 0 && readable === 0 && skipped.length > 0,
    usage: { ...probes, rule, automation, excluded_own: excludedIds.length > 0 && inv.sessions.length !== metas.length },
  };
}
