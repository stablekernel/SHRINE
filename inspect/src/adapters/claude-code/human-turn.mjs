// Human-turn rules (spec 10 adapter, with the E3 and E5 amendments), in order:
// 1) turnOrigin decides when present; 2) else promptSource (typed or queued is
// human); 3) else the fallback (meta flags, tool results). In every branch, text
// with a harness prefix is not a human turn. Subagent user lines never are.

const NOT_HUMAN_PREFIXES = [
  '[Request interrupted',
  '<command-name>',
  '<command-message>',
  '<local-command-stdout>',
  '<task-notification>',
  '<bash-stdout>',
  '<bash-stderr>',
];
const HUMAN_SOURCES = new Set(['typed', 'queued']);

export function userText(o) {
  const c = o?.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

const blocks = (o) => (Array.isArray(o?.message?.content) ? o.message.content : []);
const onlyToolResults = (o) => blocks(o).length > 0 && blocks(o).every((b) => b?.type === 'tool_result');

function isInterrupt(o, text) {
  if (o.interruptedMessageId) return true;
  if (o.toolUseResult?.interrupted === true) return true;
  if (/^\[Request interrupted by user/.test(text)) return true;
  return blocks(o).some((b) => b?.type === 'tool_result' && typeof b.content === 'string' && b.content.startsWith('[Request interrupted by user'));
}

function fallbackHuman(o) {
  if (o.isMeta === true || o.isCompactSummary === true || o.isVisibleInTranscriptOnly === true) return false;
  if (o.toolUseResult !== undefined || o.sourceToolUseID !== undefined) return false;
  return !onlyToolResults(o);
}

// Returns {human, queued, interrupt, command, text}. `text` is raw: callers scrub
// it before it leaves the adapter.
export function classifyUser(o, { subagent = false } = {}) {
  const text = userText(o);
  const trimmed = text.trimStart();
  const command = trimmed.match(/<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/)?.[1] ?? null;
  const interrupt = isInterrupt(o, trimmed);
  const prefixed = NOT_HUMAN_PREFIXES.some((p) => trimmed.startsWith(p));
  let human;
  if (subagent || prefixed || trimmed === '') human = false;
  else if (typeof o.turnOrigin === 'string') human = o.turnOrigin === 'human';
  else if (typeof o.promptSource === 'string') human = HUMAN_SOURCES.has(o.promptSource);
  else human = fallbackHuman(o);
  return { human, queued: human && o.promptSource === 'queued', interrupt: !subagent && interrupt, command: subagent ? null : command, text };
}
