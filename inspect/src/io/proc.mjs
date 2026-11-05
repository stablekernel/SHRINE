// The only module that spawns processes. Allowlist: git, plus a self-spawn of
// this package's own bin (for `start` in SP3). Nothing else.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { record } from './fsread.mjs';
import { InspectError } from '../cli/errors.mjs';

export const OWN_BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));

export function checkSpawn(cmd, args) {
  if (cmd === 'git') return;
  if (cmd === process.execPath && args[0] === OWN_BIN) return;
  throw new InspectError('E_SPAWN_DENIED', `refused to spawn ${cmd}`);
}

export function runSync(cmd, args, { cwd, env } = {}) {
  checkSpawn(cmd, args);
  record({ op: 'spawn', cmd, args, cwd, mode: 'x' });
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}
