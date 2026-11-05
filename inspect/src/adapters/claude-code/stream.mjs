// Streaming session reader (spec 10 adapter, plan T2.1 with the E2 amendment).
// A line is skipped without JSON.parse only when the first "type":"..." in its
// first 200 bytes names a known skip type; those types put `type` first in every
// line measured. Every other line is parsed, because on assistant and attachment
// lines the first "type" is nested.
import { streamLines } from '../../io/fsread.mjs';

export const SKIP_TYPES = new Set([
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'file-history-snapshot',
  'file-history-delta',
  'queue-operation',
  'ai-title',
  'last-prompt',
  'cost-state',
]);
export const READ_TYPES = new Set(['user', 'assistant', 'system', 'attachment', 'permission-mode']);
const ATTACHMENT_TYPES = new Set(['instructions', 'prompt_snapshot', 'queued_command', 'hook_additional_context']);
// Seen in E3 and read by nothing at T0; counted as known, not unknown.
const KNOWN_OTHER = new Set([
  'mode', 'custom-title', 'agent-name', 'pr-link', 'atis-latch', 'frame-link', 'tools-used', 'session-owner',
  'artifact-comment-monitor', 'artifact-autoreact-ledger', 'fork-context-ref', 'summary', 'launched', 'started', 'result',
]);
const JOB_TYPES = new Set(['launched', 'started', 'result']);
const SNIFF_BYTES = 200;

export function sniffType(line) {
  const m = line.slice(0, SNIFF_BYTES).match(/"type"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

const hasCore = (o) => typeof o.timestamp === 'string' && typeof o.sessionId === 'string' && o.message?.role === o.type;

// Calls onEvent(parsed) for each kept line. Returns per-file stats; never throws
// on a bad file (kind 'unreadable').
export async function readSessionFile(path, onEvent) {
  const stats = { kind: 'session', lines: 0, parsed: 0, skipped_by_sniff: 0, corrupt: 0, core_missing: 0, unknown_types: {}, version: null, types: {} };
  let sessionLines = 0;
  try {
    for await (const line of streamLines(path)) {
      if (line === '') continue;
      stats.lines++;
      const sniffed = sniffType(line);
      if (sniffed && SKIP_TYPES.has(sniffed)) {
        stats.skipped_by_sniff++;
        continue;
      }
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        o = undefined;
      }
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        stats.corrupt++;
        continue;
      }
      stats.parsed++;
      const type = typeof o.type === 'string' ? o.type : '(none)';
      stats.types[type] = (stats.types[type] ?? 0) + 1;
      if (!stats.version && typeof o.version === 'string') stats.version = o.version;
      if (!READ_TYPES.has(type)) {
        if (!SKIP_TYPES.has(type) && !KNOWN_OTHER.has(type)) stats.unknown_types[type] = (stats.unknown_types[type] ?? 0) + 1;
        continue;
      }
      if (type === 'user' || type === 'assistant') {
        if (!hasCore(o)) {
          stats.core_missing++;
          continue;
        }
        sessionLines++;
      }
      if (type === 'attachment' && !ATTACHMENT_TYPES.has(o.attachment?.type)) continue;
      try {
        onEvent(o);
      } catch (e) {
        // A bug in the caller is not a bad file: let it surface.
        throw Object.assign(e, { fromHandler: true });
      }
    }
  } catch (e) {
    if (e?.fromHandler) throw e;
    return { ...stats, kind: 'unreadable' };
  }
  const types = Object.keys(stats.types);
  if (!stats.version && sessionLines === 0 && types.length > 0 && types.every((t) => JOB_TYPES.has(t))) stats.kind = 'job_log';
  else if (sessionLines === 0 && stats.core_missing > 0) stats.kind = 'core_missing';
  return stats;
}
