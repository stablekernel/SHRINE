// detect(): is Claude Code present, and which locations will the adapter read.
// Reads no session content and spawns nothing. The harness version comes from
// session lines only after history consent (SP2), so here it is "not read".
import { join } from 'node:path';
import { isDir } from '../../io/fsread.mjs';

export function claudeHomeOf(home) {
  return join(home, '.claude');
}

export function detect({ home }) {
  const claudeHome = claudeHomeOf(home);
  return {
    present: isDir(claudeHome),
    name: 'Claude Code',
    version: null,
    version_note: 'not read',
    claude_home: claudeHome,
    read_paths: [claudeHome, join(home, '.claude.json')],
  };
}
