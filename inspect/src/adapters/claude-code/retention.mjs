// retention(): the history window, from cleanupPeriodDays in user settings, else
// Claude Code's documented default of 30 days.
import { join } from 'node:path';
import { exists, readJson } from '../../io/fsread.mjs';
import { claudeHomeOf } from './detect.mjs';

export const DEFAULT_RETENTION_DAYS = 30;

export function retention({ home }) {
  const path = join(claudeHomeOf(home), 'settings.json');
  if (exists(path)) {
    try {
      const days = readJson(path).cleanupPeriodDays;
      if (Number.isFinite(days) && days > 0) return { days, source: 'settings' };
    } catch {
      // unreadable settings fall back to the default
    }
  }
  return { days: DEFAULT_RETENTION_DAYS, source: 'default' };
}
