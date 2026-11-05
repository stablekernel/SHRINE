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
// Session lines are untrusted: a token count is kept only as a non-negative safe
// integer, and an id or name only as a string; anything else reads as absent.
const count = (x) => (Number.isSafeInteger(x) && x >= 0 ? x : 0);
const str = (x) => (typeof x === 'string' ? x : null);
const keyOf = (name, input) => createHash('sha1').update(`${name}\u0000${JSON.stringify(input ?? null)}`).digest('hex').slice(0, 16);

// The shas a `git commit` result prints ("[branch abc1234] subject"), from its
// head only. Only the hex ids are kept, never the result text; the linker uses
// them to tell which session made which commit.
const SHA_HEAD = 2048;
const SHA_LINE = /^\[[^\]\n]*\s([0-9a-f]{7,40})\]/gm;
export function commitShas(content) {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
  return [...text.slice(0, SHA_HEAD).matchAll(SHA_LINE)].map((m) => own(m[1]));
}

// A resent message: the same text as the human message right before it in the
// session (sent again after an interrupt or a retry). The key is a hash of the
// trimmed text with runs of whitespace made one space; the text is not kept.
export const resendKey = (text) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t ? createHash('sha256').update(t).digest('hex').slice(0, 32) : null;
};

function onLine(o, inSubagentFile, acc) {
  // Older versions wrote some subagent lines inline in the main file.
  const sub = inSubagentFile || o.isSidechain === true;
  // A forked or resumed session file starts with lines copied from an earlier
  // session, with the same uuid and timestamp. A line whose uuid an earlier
  // session already held is a copy: it is skipped here, so nothing counts twice.
  const uuid = str(o.uuid);
  if (uuid && acc.seen?.has(uuid)) {
    acc.copied.lines++;
    if (o.type === 'user' && o.message && classifyUser(o, { subagent: sub }).human) acc.copied.messages++;
    return;
  }
  if (uuid) {
    acc.own.add(uuid);
    acc.newLines++;
  }
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
    const requestId = str(o.requestId);
    if (requestId) {
      // One record per requestId; each field keeps its largest value across the
      // lines of a split response. Totals are summed once, after reading.
      const u = m.usage && typeof m.usage === 'object' ? m.usage : {};
      let rec = acc.requests.get(requestId);
      if (!rec) {
        rec = { in: 0, out: 0, cache_read: 0, sub };
        acc.requests.set(requestId, rec);
        acc.timeline.push({ t, kind: 'usage', rec, sub });
      }
      rec.in = Math.max(rec.in, count(count(u.input_tokens) + count(u.cache_creation_input_tokens)));
      rec.out = Math.max(rec.out, count(u.output_tokens));
      rec.cache_read = Math.max(rec.cache_read, count(u.cache_read_input_tokens));
    }
    if (typeof m.model === 'string' && m.model !== '<synthetic>') acc.models.add(m.model);
    // A real reply on the main thread answers the last message; an API error
    // line (synthetic model) does not, so a retry of the same text is a resend.
    if (!sub && m.model !== '<synthetic>' && o.isApiErrorMessage !== true) acc.answered = true;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        acc.timeline.push({ t, kind: 'assistant_text', text: tail(b.text.trim(), MAX_ASSISTANT), sub });
      } else if (b?.type === 'tool_use') {
        const input = b.input && typeof b.input === 'object' ? b.input : {};
        const name = str(b.name) ?? 'unknown';
        const ev = { t, kind: 'tool_use', id: str(b.id), name, key: keyOf(name, input), sub };
        if (typeof input.command === 'string') ev.command = head(input.command, MAX_COMMAND);
        const file = input.file_path ?? input.notebook_path;
        if (WRITE_TOOLS.has(name) && typeof file === 'string') ev.files = [file];
        acc.timeline.push(ev);
        acc.toolCalls++;
      }
    }
    return;
  }
  if (o.type === 'user') {
    for (const b of Array.isArray(o.message.content) ? o.message.content : []) {
      if (b?.type === 'tool_result') acc.timeline.push({ t, kind: 'tool_result', id: str(b.tool_use_id), error: b.is_error === true, shas: commitShas(b.content), sub });
    }
    const c = classifyUser(o, { subagent: sub });
    if (c.interrupt) {
      acc.interruptedSince = true;
      acc.interrupts++;
      acc.timeline.push({ t, kind: 'interrupt', sub });
    }
    if (c.command) acc.timeline.push({ t, kind: 'command', name: c.command, sub });
    if (c.human) {
      const key = resendKey(c.text);
      // Same text again counts once only when the first send got no answer or was
      // interrupted; a repeated "continue" after real work is a new message.
      if (key && key === acc.lastHumanKey && (acc.interruptedSince || !acc.answered)) {
        acc.resent++;
        return;
      }
      acc.lastHumanKey = key;
      acc.answered = false;
      acc.interruptedSince = false;
      acc.turns++;
      acc.timeline.push({ t, kind: 'human', text: head(c.text.trim(), MAX_HUMAN), queued: c.queued, uuid: str(o.uuid), sub });
    }
    return;
  }
  if (o.type === 'system' && o.subtype === 'compact_boundary' && !sub) {
    acc.compactions++;
    acc.timeline.push({ t, kind: 'compact', sub });
  }
}

// meta: {id, path, project, subagent_files, version}. seen: uuids of the sessions
// read before this one (shared across a scan; this session's uuids are added after
// it is read, so a uuid repeated inside one session is never a copy). Returns
// {session, timeline, files, dedupe} where files lists per-file stats ({path,
// kind, corrupt, unknown_types}) and dedupe = {resent, copied_lines,
// copied_messages, only_copies}.
export async function readSession(meta, { seen = null } = {}) {
  const acc = { lastT: null, start: null, end: null, requests: new Map(), models: new Set(), timeline: [], turns: 0, interrupts: 0, compactions: 0, toolCalls: 0, seen, own: new Set(), newLines: 0, copied: { lines: 0, messages: 0 }, resent: 0, lastHumanKey: null, answered: false, interruptedSince: false };
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
  if (seen) for (const u of acc.own) seen.add(u);
  const dedupe = { resent: acc.resent, copied_lines: acc.copied.lines, copied_messages: acc.copied.messages, only_copies: acc.copied.lines > 0 && acc.newLines === 0 };
  return { session, timeline, files, kind: main.kind, dedupe };
}
