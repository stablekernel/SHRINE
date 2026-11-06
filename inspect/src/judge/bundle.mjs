// Evidence pack for the Episode Classifier (plan T1 task 2). One episode per
// bundle: human turns (text), assistant replies (opening only, plus the closing
// of the last reply), tool names (no arguments), how the episode ended, and the
// lines of the live config that match the flagged turns. Code searches the whole
// config; only matching lines are sent. Every string goes through scrubSecrets,
// then mask with the known identifiers, always: secrets, names, and paths never
// reach a judge or a file. Turn ids are stable (t01, t02, ...); quotes refer to them.
import { randomBytes } from 'node:crypto';
import { scrubSecrets } from '../scrub/secrets.mjs';
import { mask, maskPath } from '../scrub/mask.mjs';
import { isCorrectionCue } from '../probes/usage.mjs';

export const JUDGE_MARKER = 'SHRINE inspect judge v1:';
export const DEFAULT_CAPS = Object.freeze({
  human_turn_chars: 1200,
  assistant_chars: 400,
  closing_chars: 300,
  turns: 12,
  bundle_tokens: 1500,
  config_excerpt_chars: 1600,
  config_line_chars: 240,
  config_lines_per_turn: 6,
  bytes_per_token: 4,
  tools_per_turn: 10,
});

export const newNonce = () => randomBytes(8).toString('hex');
export const clean = (s, known) => mask(scrubSecrets(String(s ?? '')), known);
const tid = (n) => `t${String(n).padStart(2, '0')}`;

// What the judge sees. Code-only fields (times, token counts, search results) stay in meta.
export function payloadOf(b) {
  const turn = (t) => {
    if (t.role === 'human') return { id: t.id, role: 'human', text: t.text, candidate: t.candidate, after_interrupt: t.after_interrupt };
    return { id: t.id, role: 'assistant', text: t.text, tools: t.tools, ...(t.closing ? { closing: t.closing } : {}) };
  };
  return {
    episode_id: b.episode_id,
    episode_end: b.episode_end ?? null,
    omitted_turns: b.omitted_turns ?? 0,
    turns: b.turns.map(turn),
    config_searched: b.config_searched === true,
    config: b.config.map((c) => ({ id: c.id, label: c.label, text: c.text })),
  };
}
export const bundleBytes = (b) => Buffer.byteLength(JSON.stringify(payloadOf(b)), 'utf8');
export const bundleTokens = (b, caps = DEFAULT_CAPS) => Math.ceil(bundleBytes(b) / caps.bytes_per_token);

// Words too common to tie a correction to an instruction line.
const STOP = new Set(
  'about above actually after again also always another anything before being below between both cannot could does doing done dont each either else even every first from have having here into just keep know last less like make many maybe more most much must need never next only other over please really same should since some still such sure than that their them then there these they thing things this those through want were what when where which while will with without would your yours instead again okay right good great thanks thank file files code line lines work does'.split(
    ' ',
  ),
);
const stem = (w) => w.replace(/(?:ing|ed|es|s)$/u, (m) => (w.length - m.length >= 4 ? '' : m));
export const keywords = (s) => new Set((String(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{3,}/gu) ?? []).filter((w) => !STOP.has(w)).map(stem));
const HEADING = /^\s{0,3}#{1,6}\s+\S/;

// Lines of the whole config that match a flagged turn. files: [{path, text}];
// turns: [{id, words}]. A word found on more than a quarter of the lines (in a
// config of 8 or more lines) is too common to count. Score: 2 per matching word
// in the line, 1 per matching word in its heading. Returns every line that scored
// 2 or more, best first, each with the turns it matched and its score per turn.
export function matchConfig(files, turns) {
  const rows = [];
  files.forEach((f, fi) => {
    let heading = null;
    f.text.split('\n').forEach((line, li) => {
      if (HEADING.test(line)) {
        heading = { text: line.trim(), words: keywords(line) };
        return;
      }
      if (line.trim().length < 3) return;
      rows.push({ fi, li, line: line.trim(), words: keywords(line), heading });
    });
  });
  const df = new Map();
  for (const r of rows) for (const w of r.words) df.set(w, (df.get(w) ?? 0) + 1);
  const common = (w) => rows.length >= 8 && (df.get(w) ?? 0) > rows.length / 4;
  const out = [];
  for (const r of rows) {
    let score = 0;
    const hit = [];
    const by = {};
    for (const t of turns) {
      const inLine = [...t.words].filter((w) => r.words.has(w) && !common(w)).length;
      const inHead = r.heading ? [...t.words].filter((w) => r.heading.words.has(w) && !r.words.has(w) && !common(w)).length : 0;
      const s = 2 * inLine + inHead;
      if (s >= 2) {
        hit.push(t.id);
        by[t.id] = s;
        score = Math.max(score, s);
      }
    }
    if (hit.length) out.push({ ...r, score, by, turns: hit });
  }
  return out.sort((a, b) => b.score - a.score || a.fi - b.fi || a.li - b.li);
}

// Config blocks from chosen lines, in file order: one block per file, each
// matching line under its heading. Text is what the judge quotes from.
function configBlocks(lines, files, known, caps) {
  const byFile = new Map();
  for (const r of [...lines].sort((a, b) => a.fi - b.fi || a.li - b.li)) byFile.set(r.fi, [...(byFile.get(r.fi) ?? []), r]);
  const blocks = [];
  for (const [fi, rs] of byFile) {
    const out = [];
    let lastHeading = null;
    for (const r of rs) {
      if (r.heading && r.heading !== lastHeading) out.push(r.heading.text.slice(0, caps.config_line_chars));
      lastHeading = r.heading;
      out.push(r.line.slice(0, caps.config_line_chars));
    }
    blocks.push({ id: `c${blocks.length + 1}`, label: maskPath(files[fi].path, known), text: out.join('\n'), may_have_changed: files[fi].may_have_changed });
  }
  return blocks;
}

// transcript: {events, snapshot} from the adapter. fallbackConfig: [{path,
// content, may_have_changed}] used when the session holds no snapshot.
export function buildBundle({ episode, transcript, fallbackConfig = [], known, nonce = newNonce(), caps = DEFAULT_CAPS }) {
  const turns = [];
  const meta = { turn_t: {}, human_index: {}, tokens_after: {}, human_after: {}, root_t: episode.start, terminal: episode.terminal, end: episode.end, truncated_turns: false, config_lines: {} };
  let humans = 0;
  let assistant = null;
  let lastKind = null;
  let lastReply = null;
  const usage = [];
  for (const e of transcript?.events ?? []) {
    if (e.kind === 'usage') usage.push({ t: e.t, tokens: Number.isSafeInteger(e.tokens) ? e.tokens : 0 });
    if (e.kind === 'human') {
      const id = tid(turns.length + 1);
      const afterInterrupt = lastKind === 'interrupt';
      turns.push({ id, role: 'human', text: clean(e.text, known).slice(0, caps.human_turn_chars), candidate: humans > 0 && (afterInterrupt || isCorrectionCue(e.text)), after_interrupt: afterInterrupt });
      meta.turn_t[id] = e.t;
      meta.human_index[id] = humans;
      humans++;
      assistant = null;
    } else if (e.kind === 'assistant_text' || e.kind === 'tool_use') {
      if (!assistant) {
        assistant = { id: tid(turns.length + 1), role: 'assistant', text: '', tools: [] };
        turns.push(assistant);
        meta.turn_t[assistant.id] = e.t;
      }
      if (e.kind === 'assistant_text') {
        if (!assistant.text) assistant.text = clean(e.head ?? e.text, known).slice(0, caps.assistant_chars);
        lastReply = { turn: assistant, text: e.text };
      }
      if (e.kind === 'tool_use' && assistant.tools.length < caps.tools_per_turn && !assistant.tools.includes(e.name)) assistant.tools.push(clean(e.name, known).slice(0, 64));
    }
    lastKind = e.kind;
  }
  const humanIds = turns.filter((t) => t.role === 'human').map((t) => t.id);
  humanIds.forEach((id, i) => {
    const t = meta.turn_t[id];
    meta.tokens_after[id] = usage.filter((u) => u.t && t && u.t >= t).reduce((n, u) => n + u.tokens, 0);
    meta.human_after[id] = humanIds.length - i - 1;
  });
  // The closing of the episode's last reply: where the work ended up. Only when
  // the last turn is that reply and its closing adds to the opening already sent.
  if (lastReply && turns.at(-1) === lastReply.turn) {
    const full = clean(lastReply.text, known).trim();
    // Cut at a word start, so the closing never opens on half a word.
    const closing = full.length > caps.closing_chars ? full.slice(-caps.closing_chars).replace(/^\S*\s+/, '') : full;
    if (closing && !lastReply.turn.text.includes(closing)) lastReply.turn.closing = closing;
  }

  // The whole config is searched by code for lines that match the flagged turns.
  // A file the reader had to cut means the search was not over the whole config.
  const source = transcript?.snapshot
    ? transcript.snapshot.map((f) => ({ path: f.path, content: f.content, cut: f.cut === true, may_have_changed: transcript.snapshot_late === true }))
    : fallbackConfig;
  const files = source.map((f) => ({ path: f.path, text: clean(f.content, known), may_have_changed: f.may_have_changed === true }));
  const flagged = turns.filter((t) => t.candidate).map((t) => ({ id: t.id, words: keywords(t.text) }));
  const matched = matchConfig(files, flagged);
  // Each flagged turn's best lines go first, taken in turn, so one turn with many
  // matches cannot crowd out another; then the rest by score, while they fit.
  const K = caps.config_lines_per_turn;
  const best = new Map(flagged.map((t) => [t.id, matched.filter((r) => r.by[t.id]).sort((a, b) => b.by[t.id] - a.by[t.id] || a.fi - b.fi || a.li - b.li).slice(0, K)]));
  for (const t of flagged) meta.config_lines[t.id] = { matched: matched.filter((r) => r.by[t.id]).length, best: best.get(t.id).length, sent: 0 };
  const order = [];
  for (let k = 0; k < K; k++) for (const t of flagged) {
    const r = best.get(t.id)[k];
    if (r && !order.includes(r)) order.push(r);
  }
  for (const r of matched) if (!order.includes(r)) order.push(r);
  let chosen = [];
  let used = 0;
  for (const r of order) {
    const n = Math.min(r.line.length, caps.config_line_chars) + 1;
    if (used + n > caps.config_excerpt_chars) continue;
    chosen.push(r);
    used += n;
  }
  const b = {
    episode_id: episode.id,
    nonce,
    episode_end: episode.terminal ?? null,
    omitted_turns: 0,
    turns,
    config: [],
    config_searched: source.length > 0 && !source.some((f) => f.cut === true),
    config_truncated: source.some((f) => f.cut === true),
    config_may_have_changed: source.some((f) => f.may_have_changed === true),
    config_source: transcript?.snapshot ? 'snapshot' : source.length ? 'current' : 'none',
    meta,
  };
  const setConfig = () => {
    b.config = configBlocks(chosen, files, known, caps);
    // sent: how many of that turn's best lines reached the judge.
    for (const id of Object.keys(meta.config_lines)) meta.config_lines[id].sent = best.get(id).filter((r) => chosen.includes(r)).length;
  };
  setConfig();

  // Size cap (bytes / 4). Order: shorten replies, drop middle turns that are not
  // flagged (first and last always stay), shorten turns, trim config to a floor,
  // drop flagged middle turns, then the rest of the config, then cut every turn.
  const over = () => bundleTokens(b, caps) > caps.bundle_tokens;
  const dropMiddle = (ok) => {
    const n = b.turns.length;
    const idx = b.turns
      .map((t, i) => i)
      .filter((i) => i > 0 && i < n - 1 && ok(b.turns[i]))
      .sort((x, y) => Math.abs(x - (n - 1) / 2) - Math.abs(y - (n - 1) / 2));
    if (!idx.length) return false;
    b.turns.splice(idx[0], 1);
    b.omitted_turns++;
    b.meta.truncated_turns = true;
    return true;
  };
  const trimConfig = (floor) => {
    while (over() && chosen.length && chosen.reduce((n, r) => n + r.line.length, 0) > floor) {
      chosen = chosen.slice(0, -1);
      setConfig();
    }
  };
  if (over()) for (const t of b.turns) if (t.role === 'assistant') t.text = t.text.slice(0, 160);
  while (b.turns.filter((t) => t.role === 'human').length > caps.turns && dropMiddle((t) => !t.candidate));
  while (over() && dropMiddle((t) => !t.candidate));
  if (over()) for (const t of b.turns) if (t.role === 'human' && !t.candidate && t !== b.turns[0]) t.text = t.text.slice(0, 300);
  if (over()) for (const t of b.turns) t.text = t.text.slice(0, 600);
  trimConfig(caps.config_excerpt_chars / 4);
  while (over() && dropMiddle(() => true));
  while (b.turns.filter((t) => t.role === 'human').length > caps.turns && dropMiddle(() => true));
  trimConfig(0);
  if (over()) for (const t of b.turns) {
    t.text = t.text.slice(0, 300);
    if (t.closing) t.closing = t.closing.slice(-160);
  }
  return b;
}

// The full judge input on stdin: the marker line first (so a saved judge session
// is recognized as housekeeping), the fixed instructions, then the data inside a
// fence named by a random nonce the session text cannot know.
export function judgePrompt(bundle, { template, entryIds = [], retryError = null }) {
  const head = template.replaceAll('{{NONCE}}', bundle.nonce).replaceAll('{{ENTRY_IDS}}', entryIds.join(', '));
  const data = `<data-${bundle.nonce}>\n${JSON.stringify(payloadOf(bundle))}\n</data-${bundle.nonce}>\n`;
  const retry = retryError ? `\nThe validator rejected your previous output: ${retryError}. Return one corrected JSON object.\n` : '';
  return `${head.trimEnd()}\n\n${data}${retry}`;
}
