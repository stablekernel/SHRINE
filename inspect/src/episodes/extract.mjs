// Hard-boundary episode extraction (spec 3 phase 5, plan T2.5 with the E5
// amendment). An episode starts at a human turn. It ends at: an agent commit or
// PR (pattern at command position plus a successful tool result; trailing
// replies stay in the episode until the next human turn), a task-switch command,
// an idle gap over 30 minutes, or session end. An idle gap does not cut when the
// last assistant text before it asks the user a question. Soft boundaries (topic
// changes inside one run of turns) are T2 and up.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readJson } from '../io/fsread.mjs';
import { matchesAtCommand } from '../probes/command-position.mjs';
import { episodeFlags, isCorrectionCue, isTestCommand } from '../probes/usage.mjs';

const load = (rel) => readJson(fileURLToPath(new URL(rel, import.meta.url)));
const COMMIT = load('../probes/patterns/commit.json');
const SWITCH = load('../probes/patterns/task-switch.json');
const AGENT_TOOLS = new Set(['Task', 'Agent']);
// A fresh copy, so a short tail never pins the long reply it was cut from.
const own = (s) => (typeof s === 'string' ? JSON.parse(JSON.stringify(s)) : s);

export const endsWithQuestion = (text) => /\?\s*[*_`)"'\]]*\s*$/.test(text ?? '');

export function commitKind(command) {
  if (matchesAtCommand(command, COMMIT.pr)) return 'pr';
  if (matchesAtCommand(command, COMMIT.commit)) return 'commit';
  return null;
}

const episodeId = (sessionId, n) => `e-${createHash('sha256').update(`${sessionId}|${n}`).digest('hex').slice(0, 12)}`;

export function extractEpisodes(session, timeline, { idleMinutes = 30 } = {}) {
  const idle = idleMinutes * 60000;
  const out = [];
  const pendingCommit = new Map();
  let cur = null;
  let lastT = null;
  let lastQuestion = false;

  const open = (e) => ({
    id: episodeId(session.id, out.length),
    session_id: session.id,
    project: session.project,
    root_turn_id: e.uuid ?? `${session.id}:${out.length}`,
    start: e.t,
    end: e.t,
    closed_by: null,
    human_turns: 0,
    assistant_turns: 0,
    interrupts: 0,
    tokens: 0,
    subagents: 0,
    compactions: 0,
    touched: new Set(),
    committed: false,
    // Shas the session's own commit results printed: the linker's best evidence.
    commit_refs: [],
    calls: [],
    humans: [],
    last_text: '',
    last_text_t: null,
    last_kind: null,
  });
  const finish = (terminal) => {
    if (!cur) return;
    // Flags are computed here and the per-call and per-turn lists dropped, so a
    // multi-GB history keeps only small episode records.
    const { touched, closed_by, last_kind, calls, humans, last_text, ...rest } = cur;
    const flags = episodeFlags({ calls, humans, last_text, last_text_t: cur.last_text_t });
    const corr = humans.find((h) => h.index > 0 && (h.after_interrupt || h.cue));
    out.push({ ...rest, terminal, touched_files: [...touched].sort(), flags, correction_t: corr?.t ?? null });
    cur = null;
  };

  for (const e of timeline) {
    if (lastT && e.t && Date.parse(e.t) - Date.parse(lastT) > idle && !lastQuestion && cur) finish(cur.closed_by ?? 'new_task');
    if (e.t) lastT = e.t;
    if (e.kind === 'command' && SWITCH.commands.includes(e.name)) {
      finish(cur?.closed_by ?? 'new_task');
      continue;
    }
    if (e.kind === 'human') {
      if (cur?.closed_by) finish(cur.closed_by);
      if (!cur) cur = open(e);
      // Only derived flags are kept, never the text, so episodes stay small across a large history.
      cur.humans.push({ t: e.t, index: cur.human_turns, after_interrupt: cur.last_kind === 'interrupt', cue: isCorrectionCue(e.text) });
      cur.human_turns++;
      lastQuestion = false;
    }
    if (!cur) continue;
    cur.end = e.t ?? cur.end;
    cur.last_kind = e.kind;
    if (e.kind === 'usage') {
      cur.tokens += e.tokens;
      if (!e.sub) cur.assistant_turns++;
    } else if (e.kind === 'assistant_text' && !e.sub) {
      cur.last_text = own(e.text);
      cur.last_text_t = e.t;
      lastQuestion = endsWithQuestion(e.text);
    } else if (e.kind === 'tool_use') {
      cur.calls.push({ t: e.t, name: e.name, test: e.name === 'Bash' && isTestCommand(e.command), key: e.key, sub: e.sub === true, human_turns_before: cur.human_turns });
      for (const f of e.files ?? []) cur.touched.add(f);
      if (!e.sub && AGENT_TOOLS.has(e.name)) cur.subagents++;
      const k = e.name === 'Bash' ? commitKind(e.command) : null;
      if (k && e.id) pendingCommit.set(e.id, k);
      if (!e.sub) lastQuestion = false;
    } else if (e.kind === 'tool_result') {
      const k = pendingCommit.get(e.id);
      if (k && !e.error) {
        cur.committed = true;
        cur.commit_refs.push(...(e.shas ?? []));
        cur.closed_by = k;
      }
      pendingCommit.delete(e.id);
    } else if (e.kind === 'interrupt') cur.interrupts++;
    else if (e.kind === 'compact') cur.compactions++;
  }
  finish(cur?.closed_by ?? 'session_end');
  return out;
}
