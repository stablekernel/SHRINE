// Synthetic Claude Code session histories for e2e tests. Lines follow the real
// shapes measured in E3 (assistant lines put `message` before `type`, tokens
// repeat per requestId, tool results carry toolUseResult). Never real content.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';

let seq = 0;
const uid = (p) => `${p}-${String(++seq).padStart(6, '0')}`;

// script ops: ['human', text, gapMinutes?], ['text', text], ['bash', command, ok?],
// ['edit', file], ['interrupt'], ['compact'], ['clear'].
export function sessionLines({ id, cwd, startMs, script, version = '2.1.318', entrypoint = 'cli', tokens = 4000 }) {
  let t = startMs;
  const lines = [];
  const base = () => ({ timestamp: new Date(t).toISOString(), sessionId: id, version, cwd, entrypoint, gitBranch: 'main', userType: 'external' });
  const asst = (content) => {
    t += 20000;
    const req = uid('req');
    lines.push({ parentUuid: null, isSidechain: false, message: { model: 'claude-test-1', id: uid('msg'), type: 'message', role: 'assistant', content, usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens * 5, output_tokens: Math.round(tokens / 4) } }, requestId: req, type: 'assistant', uuid: uid('u'), ...base() });
  };
  const result = (toolId, ok, out) => {
    t += 5000;
    lines.push({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: [{ tool_use_id: toolId, type: 'tool_result', content: out, is_error: !ok }] }, uuid: uid('u'), toolUseResult: { stdout: out, stderr: '', interrupted: false }, ...base() });
  };
  lines.push({ type: 'permission-mode', permissionMode: 'default', sessionId: id });
  for (const op of script) {
    const [kind, a, b] = op;
    if (kind === 'human') {
      t += (b ?? 1) * 60000;
      lines.push({ parentUuid: null, isSidechain: false, promptId: uid('p'), type: 'user', message: { role: 'user', content: a }, uuid: uid('u'), promptSource: 'typed', turnOrigin: 'human', ...base() });
    } else if (kind === 'text') asst([{ type: 'text', text: a }]);
    else if (kind === 'bash') {
      const tid = uid('toolu');
      asst([{ type: 'tool_use', id: tid, name: 'Bash', input: { command: a, description: 'run' } }]);
      result(tid, b !== false, b === false ? 'exit 1' : 'ok');
    } else if (kind === 'edit') {
      const tid = uid('toolu');
      asst([{ type: 'tool_use', id: tid, name: 'Edit', input: { file_path: join(cwd, a), old_string: 'a', new_string: 'b' } }]);
      result(tid, true, 'edited');
    } else if (kind === 'interrupt') {
      t += 3000;
      lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, uuid: uid('u'), ...base() });
    } else if (kind === 'compact') {
      t += 3000;
      lines.push({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 150000 }, uuid: uid('u'), ...base() });
      lines.push({ type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary of earlier work.' }, uuid: uid('u'), ...base() });
    } else if (kind === 'clear') {
      t += 3000;
      lines.push({ type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>\n<command-message>clear</command-message>' }, uuid: uid('u'), ...base() });
    }
    lines.push({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(t).toISOString(), sessionId: id });
  }
  lines.push({ type: 'last-prompt', lastPrompt: 'not parsed', sessionId: id });
  return { text: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, endMs: t };
}

// Writes one session file into the fixture home's projects folder for `cwd`.
export function addSession(h, { id, cwd = h.repo, startMs, script, mtime, ...rest }) {
  const dir = join(h.claudeHome, 'projects', encodeProjectPath(cwd));
  mkdirSync(dir, { recursive: true });
  const { text, endMs } = sessionLines({ id, cwd, startMs, script, ...rest });
  const file = join(dir, `${id}.jsonl`);
  writeFileSync(file, text);
  const m = mtime ?? new Date(endMs);
  utimesSync(file, m, m);
  return file;
}

const DAY = 86400000;
const sid = (prefix, i) => `${prefix}0000-0000-4000-8000-${String(i).padStart(12, '0')}`;

// Presets. `nowMs` anchors the window; sessions spread over the last 20 days.
export const PRESETS = {
  // Asks, edits, tests, reports with the run, commits. No corrections.
  clean: (i) => [['human', `Add input validation to module ${i}.`], ['edit', `src/m${i}.js`], ['bash', 'npm test'], ['text', 'Done. npm test ran: 12 tests passed.'], ['bash', `git commit -qm "validate m${i}"`]],
  // Short prompts, tests first, few turns.
  expert: (i) => [['human', `fix m${i} null case`], ['bash', 'npm test', false], ['edit', `src/m${i}.js`], ['bash', 'npm test'], ['text', 'Fixed. Tests pass.']],
  // Done claims with no test run, corrections, retries, an interrupt.
  planted: (i) => [
    ['human', `Refactor the parser in module ${i}.`],
    ['edit', `src/p${i}.js`],
    ['bash', 'ls src'],
    ['bash', 'ls src'],
    ['text', 'All done.'],
    ['interrupt'],
    ['human', 'No, keep the old function name.'],
    ['edit', `src/p${i}.js`],
    ['text', 'The parser is now fixed.'],
  ],
};

export function addHistory(h, preset, { count = 12, nowMs, prefix = 'aaaa', entrypoint = 'cli', cwd } = {}) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const startMs = nowMs - (20 - i) * DAY;
    files.push(addSession(h, { id: sid(prefix, i), startMs, script: PRESETS[preset](i), entrypoint, cwd }));
  }
  return files;
}
