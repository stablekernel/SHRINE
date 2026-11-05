// collectSetup(): everything the T0 config probes need, read once through the
// read-only IO layer: inventory, always-loaded size, retention, last-change dates
// (git first, else mtime), and each repo's instruction-file layout.
import { basename, dirname, join, relative, resolve } from 'node:path';
import { userInfo } from 'node:os';
import { exists, readLines, readText, stat } from '../../io/fsread.mjs';
import { gitOut, gitRead, historyReadable } from '../../io/git.mjs';
import { inventory } from './inventory.mjs';
import { alwaysLoaded } from './always-loaded.mjs';
import { retention } from './retention.mjs';

function lastChange(item) {
  if (item.virtual || !item.mtime) return null;
  // Partial clone on a git that can lazy-fetch: no git date, and date checks treat
  // the file as not applicable.
  if (!historyReadable(dirname(item.path))) return { date: item.mtime, source: 'mtime', git_skipped: true };
  const { out: date, failed } = gitRead(['log', '-1', '--format=%cI', '--', basename(item.path)], dirname(item.path));
  // Git could not read the repo (timed out, or refused another user's repo): the
  // git date is unknown, not absent, so date checks skip the file the same way.
  if (failed) return { date: item.mtime, source: 'mtime', git_skipped: true };
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

// url = values in a git config. Spaces are matched with [ \t], not \s: with the m
// flag, \s also crosses newlines, so every line start would rescan a run of blank
// lines (quadratic).
export function remoteUrls(text) {
  return [...String(text ?? '').matchAll(/^[ \t]*url[ \t]*=[ \t]*(\S+)[ \t]*\r?$/gm)].map((m) => m[1]);
}

// The [user] name and email a git config file sets, read as text (no git run), so
// the user's own git identity is masked even where git history is not read.
export function configUser(text) {
  const user = {};
  let section = '';
  for (const line of String(text ?? '').split('\n')) {
    const head = /^[ \t]*\[([^\]\s]+)/.exec(line);
    if (head) {
      section = head[1].toLowerCase();
      continue;
    }
    const kv = section === 'user' && /^[ \t]*(name|email)[ \t]*=(.*)$/i.exec(line);
    if (kv) user[kv[1].toLowerCase()] = kv[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return user.name || user.email ? { name: user.name ?? null, email: user.email ?? null } : null;
}

// Every path segment between host and repo name (nested groups, Azure org and
// project); host-less local remotes give none.
export function remoteOrgs(url) {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i) ?? url.match(/^[^/:\s]+@[^/:\s]+:(.+)$/);
  if (!m) return [];
  const segs = m[1].split('/').filter(Boolean);
  return segs.slice(0, -1).filter((s) => s !== '_git' && s !== 'v3');
}

// The git dir that holds a work tree's shared config, found the way git finds it
// and read as files (no git run): .git itself, or, where .git is a file (a linked
// worktree or a submodule), the "gitdir:" it names; then that dir's commondir.
export function commonGitDir(root) {
  const dotGit = join(root, '.git');
  const st = stat(dotGit);
  if (!st) return null;
  let dir = dotGit;
  if (st.isFile()) {
    const m = /^gitdir:[ \t]*(.*?)[ \t]*$/.exec(readLines(dotGit, 1, 4096)[0] ?? '');
    if (!m?.[1]) return null;
    dir = resolve(root, m[1]);
  }
  const commondir = join(dir, 'commondir');
  if (stat(commondir)?.isFile()) {
    const rel = (readLines(commondir, 1, 4096)[0] ?? '').trim();
    if (rel) dir = resolve(dir, rel);
  }
  return dir;
}

// Known identifiers for share-safe masking (spec 7): OS user, home, git authors,
// project and repo names, org names from remotes (read from the repo's git config,
// read-only).
export function knownIdentifiers({ home, projects }) {
  const authors = [];
  const orgs = [];
  const addAuthor = (a) => {
    if (a && !authors.some((x) => x.email === a.email && x.name === a.name)) authors.push(a);
  };
  for (const cfg of [join(home ?? '', '.gitconfig'), join(home ?? '', '.config', 'git', 'config')]) {
    if (home && exists(cfg)) addAuthor(configUser(readText(cfg)));
  }
  for (const p of projects) {
    const log = gitOut(['log', '-n', '200', '--format=%an%x09%ae'], p.root);
    for (const line of (log ?? '').split('\n').filter(Boolean)) {
      const [name, email] = line.split('\t');
      if (!authors.some((a) => a.email === email)) authors.push({ name, email });
    }
    const common = commonGitDir(p.root);
    const cfg = common && join(common, 'config');
    if (cfg && stat(cfg)?.isFile()) {
      const text = readText(cfg);
      for (const url of remoteUrls(text)) orgs.push(...remoteOrgs(url));
      addAuthor(configUser(text));
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
