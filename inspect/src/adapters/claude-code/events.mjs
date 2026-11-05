// Event normalization (spec 10 adapter, plan T2.3). Reads one session file plus
// its subagent transcripts (joined by folder) and returns a session summary and a
// time-ordered timeline for episode extraction. Tokens are summed once per
// requestId; attributable = input (including cache writes) + output, cache_read
// kept apart. Subagent tokens count; subagent user lines are never human turns.
// Every text that leaves this module went through the default scrubber.
import { createHash } from 'node:crypto';
import { readSessionFile } from './stream.mjs';
import { classifyUser } from './human-turn.mjs';
import { scrubSecrets } from '../../scrub/secrets.mjs';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_HUMAN = 1000;
const MAX_ASSISTANT = 600;
const MAX_COMMAND = 2000;

// Cut copies are flattened, so a short cut never pins the long string it came from.
const own = (s) => JSON.parse(JSON.stringify(s));
// Scrub before the final cut, so a cut never leaves half a secret that no pattern
// matches; the margin bounds the scrub cost on very long texts.
const MARGIN = 512;
const tail = (s, n) => {
  const x = scrubSecrets(s.length > n + MARGIN ? s.slice(-(n + MARGIN)) : s);
  return own(x.length > n ? x.slice(-n) : x);
};
const head = (s, n) => {
  const x = scrubSecrets(s.length > n + MARGIN ? s.slice(0, n + MARGIN) : s);
  return own(x.length > n ? x.slice(0, n) : x);
};
const keyOf = (name, input) => createHash('sha1').update(`${name}\u0000${JSON.stringify(input ?? null)}`).digest('hex').slice(0, 16);

// The shas a `git commit` result prints ("[branch abc1234] subject"), from its
// head only. Only the hex ids are kept, never the result text; the linker uses
// them to tell which session made which commit.
const SHA_HEAD = 2048;
const SHA_LINE = /^\[[^\]\n]*\s([0-9a-f]{7,40})\]/gm;
function commitShas(content) {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
  return [...text.slice(0, SHA_HEAD).matchAll(SHA_LINE)].map((m) => own(m[1]));
}

function onLine(o, inSubagentFile, acc) {
  // Older versions wrote some subagent lines inline in the main file.
  const sub = inSubagentFile || o.isSidechain === true;
  // Only a parsable string timestamp counts; anything else falls back to the last good one.
  const valid = typeof o.timestamp === 'string' && !Number.isNaN(Date.parse(o.timestamp));
  const t = valid ? o.timestamp : acc.lastT;
  if (t) {
    acc.lastT = t;
    if (!acc.start || t < acc.start) acc.start = t;
    if (!acc.end || t > acc.end) acc.end = t;
  }
  if (o.type === 'assistant') {
    const m = o.message;
    if (o.requestId) {
      // One record per requestId; each field keeps its largest value across the
      // lines of a split response. Totals are summed once, after reading.
      const u = m.usage ?? {};
      let rec = acc.requests.get(o.requestId);
      if (!rec) {
        rec = { in: 0, out: 0, cache_read: 0, sub };
        acc.requests.set(o.requestId, rec);
        acc.timeline.push({ t, kind: 'usage', rec, sub });
      }
      rec.in = Math.max(rec.in, (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
      rec.out = Math.max(rec.out, u.output_tokens ?? 0);
      rec.cache_read = Math.max(rec.cache_read, u.cache_read_input_tokens ?? 0);
    }
    if (typeof m.model === 'string' && m.model !== '<synthetic>') acc.models.add(m.model);
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        acc.timeline.push({ t, kind: 'assistant_text', text: tail(b.text.trim(), MAX_ASSISTANT), sub });
      } else if (b?.type === 'tool_use') {
        const input = b.input ?? {};
        const ev = { t, kind: 'tool_use', id: b.id ?? null, name: b.name ?? 'unknown', key: keyOf(b.name, input), sub };
        if (typeof input.command === 'string') ev.command = head(input.command, MAX_COMMAND);
        const file = input.file_path ?? input.notebook_path;
        if (WRITE_TOOLS.has(b.name) && typeof file === 'string') ev.files = [file];
        acc.timeline.push(ev);
        acc.toolCalls++;
      }
    }
    return;
  }
  if (o.type === 'user') {
    for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
      if (b?.type === 'tool_result') acc.timeline.push({ t, kind: 'tool_result', id: b.tool_use_id ?? null, error: b.is_error === true, shas: commitShas(b.content), sub });
    }
    const c = classifyUser(o, { subagent: sub });
    if (c.interrupt) {
      acc.interrupts++;
      acc.timeline.push({ t, kind: 'interrupt', sub });
    }
    if (c.command) acc.timeline.push({ t, kind: 'command', name: c.command, sub });
    if (c.human) {
      acc.turns++;
      acc.timeline.push({ t, kind: 'human', text: head(c.text.trim(), MAX_HUMAN), queued: c.queued, uuid: o.uuid ?? null, sub });
    }
    return;
  }
  if (o.type === 'system' && o.subtype === 'compact_boundary' && !sub) {
    acc.compactions++;
    acc.timeline.push({ t, kind: 'compact', sub });
  }
}

// meta: {id, path, project, subagent_files, version}. Returns {session, timeline, files}
// where files lists per-file stats ({path, kind, corrupt, unknown_types}).
export async function readSession(meta) {
  const acc = { lastT: null, start: null, end: null, requests: new Map(), models: new Set(), timeline: [], turns: 0, interrupts: 0, compactions: 0, toolCalls: 0 };
  const files = [];
  const main = await readSessionFile(meta.path, (o) => onLine(o, false, acc));
  files.push({ path: meta.path, ...main });
  for (const p of meta.subagent_files ?? []) {
    acc.lastT = null;
    const s = await readSessionFile(p, (o) => onLine(o, true, acc));
    files.push({ path: p, ...s });
  }
  // Stable sort keeps file order for equal timestamps.
  const timeline = acc.timeline.map((e, i) => ({ e, i })).sort((a, b) => (a.e.t < b.e.t ? -1 : a.e.t > b.e.t ? 1 : a.i - b.i)).map((x) => x.e);
  const tokens = { in: 0, out: 0, cache_read: 0 };
  let subTokens = 0;
  for (const r of acc.requests.values()) {
    tokens.in += r.in;
    tokens.out += r.out;
    tokens.cache_read += r.cache_read;
    if (r.sub) subTokens += r.in + r.out;
  }
  for (const e of timeline) {
    if (e.kind === 'usage') {
      e.tokens = e.rec.in + e.rec.out;
      delete e.rec;
    }
  }
  const attributable = tokens.in + tokens.out;
  const session = {
    id: meta.id,
    project: meta.project,
    start: acc.start ?? new Date(meta.mtime ?? 0).toISOString(),
    end: acc.end ?? new Date(meta.mtime ?? 0).toISOString(),
    turns: acc.turns,
    tokens,
    models: [...acc.models].sort(),
    subagent_share: attributable ? Math.round((subTokens / attributable) * 1000) / 1000 : 0,
    compactions: acc.compactions,
    interrupts: acc.interrupts,
    tool_calls: acc.toolCalls,
    subagents: (meta.subagent_files ?? []).length,
    version: main.version ?? meta.version ?? null,
  };
  return { session, timeline, files, kind: main.kind };
}
