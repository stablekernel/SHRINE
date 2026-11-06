// State and cache folders per OS. Env overrides exist for tests and CI.
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP = 'shrine-inspect';

export function appDirs({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (env.SHRINE_INSPECT_STATE_DIR || env.SHRINE_INSPECT_CACHE_DIR) {
    return {
      state: env.SHRINE_INSPECT_STATE_DIR ?? join(env.SHRINE_INSPECT_CACHE_DIR, '..', `${APP}-state`),
      cache: env.SHRINE_INSPECT_CACHE_DIR ?? join(env.SHRINE_INSPECT_STATE_DIR, '..', `${APP}-cache`),
    };
  }
  if (platform === 'darwin') {
    return {
      state: join(home, 'Library', 'Application Support', APP),
      cache: join(home, 'Library', 'Caches', APP),
    };
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return { state: join(base, APP, 'state'), cache: join(base, APP, 'cache') };
  }
  return {
    state: join(env.XDG_STATE_HOME || join(home, '.local', 'state'), APP),
    cache: join(env.XDG_CACHE_HOME || join(home, '.cache'), APP),
  };
}
