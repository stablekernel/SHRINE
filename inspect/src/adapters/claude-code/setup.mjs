// collectSetup(): everything the T0 config probes need, read once through the
// read-only IO layer: inventory, always-loaded size, retention, last-change dates
// (git first, else mtime), and each repo's instruction-file layout.
import { basename, dirname, join, relative } from 'node:path';
import { userInfo } from 'node:os';
import { exists, readText } from '../../io/fsread.mjs';
import { gitOut } from '../../io/git.mjs';
import { inventory } from './inventory.mjs';
import { alwaysLoaded } from './always-loaded.mjs';
import { retention } from './retention.mjs';

function lastChange(item) {
  if (item.virtual || !item.mtime) return null;
  const date = gitOut(['log', '-1', '--format=%cI', '--', basename(item.path)], dirname(item.path));
  if (date) return { date: new Date(date).toISOString(), source: 'git' };
  return { date: item.mtime, source: 'mtime' };
}

function layoutOf(root, items) {
  const keys = new Set();
  for (const i of items) {
    const p = i.path.split('#')[0];
    if (!p.startsWith(`${root}/`)) continue;
    const rel = relative(root, p).split('\\').join('/');
    if (rel === 'CLAUDE.md' || rel === '.claude/CLAUDE.md' || rel === '.claude/settings.json' || rel === '.mcp.json') keys.add(rel);
    else if (rel.endsWith('/CLAUDE.md') && !rel.startsWith('.claude/')) keys.add('nested CLAUDE.md');
    else if (/^\.claude\/(agents|commands|skills|rules)\//.test(rel)) keys.add(rel.split('/').slice(0, 2).join('/'));
  }
  return [...keys].sort();
}

export function collectSetup({ home, projects, now }) {
  const inv = inventory({ home, projects });
  for (const i of inv.items) if (i.kind === 'instruction' || i.kind === 'memory') i.last_change = lastChange(i);
  return {
    now,
    inventory: inv,
    items: inv.items,
    permissions: inv.permissions,
    always_loaded: alwaysLoaded({ home, projects, inventory: inv }),
    retention: retention({ home }),
    repos: projects.map((p) => ({ root: p.root, layout: layoutOf(p.root, inv.items) })),
  };
}

// Every path segment between host and repo name (nested groups, Azure org and
// project); host-less local remotes give none.
export function remoteOrgs(url) {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i) ?? url.match(/^[^/:\s]+@[^/:\s]+:(.+)$/);
  if (!m) return [];
  const segs = m[1].split('/').filter(Boolean);
  return segs.slice(0, -1).filter((s) => s !== '_git' && s !== 'v3');
}

// Known identifiers for share-safe masking (spec 7): OS user, home, git authors,
// project and repo names, org names from remotes (read from .git/config, read-only).
export function knownIdentifiers({ home, projects }) {
  const authors = [];
  const orgs = [];
  for (const p of projects) {
    const log = gitOut(['log', '-n', '200', '--format=%an%x09%ae'], p.root);
    for (const line of (log ?? '').split('\n').filter(Boolean)) {
      const [name, email] = line.split('\t');
      if (!authors.some((a) => a.email === email)) authors.push({ name, email });
    }
    const cfg = join(p.root, '.git', 'config');
    if (exists(cfg)) {
      for (const m of readText(cfg).matchAll(/^\s*url\s*=\s*(\S+)\s*$/gm)) orgs.push(...remoteOrgs(m[1]));
    }
  }
  let osUser = null;
  try {
    osUser = userInfo().username;
  } catch {
    osUser = null;
  }
  const names = projects.map((p) => basename(p.root));
  return { osUser, home, authors, projects: names, repos: names, orgs: [...new Set(orgs)] };
}
