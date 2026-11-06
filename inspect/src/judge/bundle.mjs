// Evidence pack for the Episode Classifier (plan T1 task 2). One episode per
// bundle: human turns (text), assistant summaries (opening only), tool names (no
// arguments), and the live config. Every string goes through scrubSecrets, then
// mask with the known identifiers, always: secrets, names, and paths never reach
// a judge or a file. Turn ids are stable (t01, t02, ...); quotes refer to them.
import { randomBytes } from 'node:crypto';
import { scrubSecrets } from '../scrub/secrets.mjs';
import { mask, maskPath } from '../scrub/mask.mjs';
import { isCorrectionCue } from '../probes/usage.mjs';

export const JUDGE_MARKER = 'SHRINE inspect judge v1:';
export const DEFAULT_CAPS = Object.freeze({ human_turn_chars: 1200, assistant_chars: 400, turns: 12, bundle_tokens: 900, config_chars: 12000, bytes_per_token: 4, tools_per_turn: 10 });

export const newNonce = () => randomBytes(8).toString('hex');
export const clean = (s, known) => mask(scrubSecrets(String(s ?? '')), known);
const tid = (n) => `t${String(n).padStart(2, '0')}`;

// What the judge sees. Code-only fields (times, token counts) stay in meta.
export function payloadOf(b) {
  return {
    episode_id: b.episode_id,
    turns: b.turns.map((t) => (t.role === 'human' ? { id: t.id, role: 'human', text: t.text, candidate: t.candidate, after_interrupt: t.after_interrupt } : { id: t.id, role: 'assistant', text: t.text, tools: t.tools })),
    config: b.config.map((c) => ({ id: c.id, label: c.label, text: c.text })),
  };
}
export const bundleBytes = (b) => Buffer.byteLength(JSON.stringify(payloadOf(b)), 'utf8');
export const bundleTokens = (b, caps = DEFAULT_CAPS) => Math.ceil(bundleBytes(b) / caps.bytes_per_token);

// transcript: {events, snapshot} from the adapter. fallbackConfig: [{path,
// content, may_have_changed}] used when the session holds no snapshot.
export function buildBundle({ episode, transcript, fallbackConfig = [], known, nonce = newNonce(), caps = DEFAULT_CAPS }) {
  const turns = [];
  const meta = { turn_t: {}, human_index: {}, tokens_after: {}, human_after: {}, root_t: episode.start, terminal: episode.terminal, end: episode.end, truncated_turns: false };
  let humans = 0;
  let assistant = null;
  let lastKind = null;
  const usage = [];
  for (const e of transcript?.events ?? []) {
    if (e.kind === 'usage') usage.push({ t: e.t, tokens: Number.isSafeInteger(e.tokens) ? e.tokens : 0 });
    if (e.kind === 'human') {
      if (humans >= caps.turns) {
        meta.truncated_turns = true;
        break;
      }
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
      if (e.kind === 'assistant_text' && !assistant.text) assistant.text = clean(e.head ?? e.text, known).slice(0, caps.assistant_chars);
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

  const source = transcript?.snapshot
    ? transcript.snapshot.map((f) => ({ path: f.path, content: f.content, may_have_changed: transcript.snapshot_late === true }))
    : fallbackConfig;
  let budget = caps.config_chars;
  let truncated = false;
  const config = [];
  for (const f of source) {
    const text = clean(f.content, known);
    const take = text.slice(0, Math.max(0, budget));
    if (take.length < text.length) truncated = true;
    if (!take) continue;
    config.push({ id: `c${config.length + 1}`, label: maskPath(f.path, known), text: take, may_have_changed: f.may_have_changed === true });
    budget -= take.length;
  }
  const b = { episode_id: episode.id, nonce, turns, config, config_truncated: truncated, config_source: transcript?.snapshot ? 'snapshot' : source.length ? 'current' : 'none', meta };

  // Size cap (bytes / 4): shorten replies, then config, then drop trailing turns, then cut long turns.
  const over = () => bundleTokens(b, caps) > caps.bundle_tokens;
  if (over()) for (const t of b.turns) if (t.role === 'assistant') t.text = t.text.slice(0, 160);
  while (over() && b.config.length && b.config.reduce((n, c) => n + c.text.length, 0) > 2000) {
    const last = b.config.at(-1);
    last.text = last.text.slice(0, Math.floor(last.text.length / 2));
    if (!last.text) b.config.pop();
    b.config_truncated = true;
  }
  while (over() && b.turns.length > 2) {
    b.turns.pop();
    b.meta.truncated_turns = true;
  }
  if (over()) for (const t of b.turns) t.text = t.text.slice(0, 600);
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
