// Project listing for Gate A (spec 3 phase 1, spec 10 adapter). Before consent it
// reads filesystem metadata plus, from one session file per folder, the cwd and
// entrypoint keys of the first line carrying cwd, within the first 10 lines.
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, list, readJson, readLines, stat } from '../../io/fsread.mjs';
import { gitOut } from '../../io/git.mjs';

const TEMP = readJson(fileURLToPath(new URL('../../probes/patterns/temp-folder.json', import.meta.url)));
const MAX_CWD_LINES = 10;
const DEFAULT_VIEW = 20;

// Claude Code names a project folder after its cwd with separators and dots as dashes.
export function encodeProjectPath(cwd) {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-');
}

export function defaultTempPatterns(env = process.env) {
  return env.SHRINE_INSPECT_TEMP_PATTERNS ? JSON.parse(env.SHRINE_INSPECT_TEMP_PATTERNS) : TEMP.patterns;
}

export function isTempPath(cwd, patterns = TEMP.patterns) {
  return patterns.some((p) => new RegExp(p).test(cwd));
}

function sampleMeta(file) {
  for (const line of readLines(file, MAX_CWD_LINES)) {
    if (!line.includes('"cwd"')) continue;
    try {
      const o = JSON.parse(line);
      const s = (v) => (typeof v === 'string' ? v : null);
      if (typeof o.cwd === 'string') return { cwd: o.cwd, entrypoint: s(o.entrypoint), version: s(o.version) };
    } catch {
      // a corrupt line is skipped; the next one may carry cwd
    }
  }
  return null;
}

// Main repo root for a cwd: git common dir when the folder exists, else strip a
// /.worktrees/<name> segment (E3: worktree folders are often already removed).
export function repoRoot(cwd) {
  const wt = cwd.match(/^(.*?)\/\.worktrees\/[^/]+/);
  if (exists(cwd)) {
    // --path-format needs git 2.31; older git echoes it back, so resolve here.
    const out = gitOut(['rev-parse', '--git-common-dir'], cwd);
    const common = out && !out.includes('\n') ? resolve(cwd, out) : null;
    if (common && basename(common) === '.git') return dirname(common);
    // Submodules keep their git dir under <super>/.git/modules; use the work tree.
    const top = gitOut(['rev-parse', '--show-toplevel'], cwd);
    if (top) return top;
    if (common) return common;
    return wt ? wt[1] : cwd;
  }
  return wt ? wt[1] : cwd;
}

// tempPatterns: override for tests whose fixtures live under the OS temp folder.
export function listProjects({ claudeHome, now = Date.now(), windowDays = 30, tempPatterns = defaultTempPatterns() }) {
  const since = now - windowDays * 86400000;
  const byRoot = new Map();
  const excluded = [];
  for (const folder of list(join(claudeHome, 'projects')).filter((e) => e.dir)) {
    const dir = join(claudeHome, 'projects', folder.name);
    const files = list(dir)
      .filter((e) => !e.dir && e.name.endsWith('.jsonl'))
      .map((e) => {
        const s = stat(join(dir, e.name));
        return s && { path: join(dir, e.name), bytes: s.size, mtime: s.mtimeMs };
      })
      .filter((f) => f && f.mtime >= since);
    if (files.length === 0) continue;
    files.sort((a, b) => b.mtime - a.mtime);
    const meta = sampleMeta(files[0].path);
    const bytes = files.reduce((n, f) => n + f.bytes, 0);
    if (!meta) {
      excluded.push({ folder: folder.name, cwd: null, reason: 'no_cwd', sessions: files.length, bytes });
      continue;
    }
    if (isTempPath(meta.cwd, tempPatterns)) {
      excluded.push({ folder: folder.name, cwd: meta.cwd, reason: 'temp', sessions: files.length, bytes });
      continue;
    }
    if (meta.entrypoint === 'sdk-cli') {
      excluded.push({ folder: folder.name, cwd: meta.cwd, reason: 'automation', sessions: files.length, bytes });
      continue;
    }
    // Subagent transcripts sit in <session>/subagents/; metadata only, for the size estimate.
    const subBytes = files.reduce((n, f) => n + subagentFiles(f.path).reduce((m, s) => m + s.bytes, 0), 0);
    const root = repoRoot(meta.cwd);
    const p = byRoot.get(root) ?? { id: root, name: basename(root), root, cwds: [], folders: [], files: [], sessions: 0, bytes: 0, bytes_with_subagents: 0, first_mtime: Infinity, last_mtime: 0 };
    p.cwds.push(meta.cwd);
    p.folders.push(folder.name);
    p.files.push(...files);
    p.sessions += files.length;
    p.bytes += bytes;
    p.bytes_with_subagents += bytes + subBytes;
    p.first_mtime = Math.min(p.first_mtime, ...files.map((f) => f.mtime));
    p.last_mtime = Math.max(p.last_mtime, files[0].mtime);
    byRoot.set(root, p);
  }
  const projects = [...byRoot.values()]
    .map((p) => ({ ...p, first_mtime: new Date(p.first_mtime).toISOString(), last_mtime: new Date(p.last_mtime).toISOString() }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return { projects, top: projects.slice(0, DEFAULT_VIEW), more: Math.max(0, projects.length - DEFAULT_VIEW), excluded, window_days: windowDays };
}

// Subagent transcripts of one session file: [{path, bytes}].
export function subagentFiles(sessionPath) {
  const dir = join(dirname(sessionPath), basename(sessionPath, '.jsonl'), 'subagents');
  return list(dir)
    .filter((e) => !e.dir && e.name.endsWith('.jsonl'))
    .map((e) => ({ path: join(dir, e.name), bytes: stat(join(dir, e.name))?.size ?? 0 }));
}

// After Gate A consent: per-session metadata from the first lines of every session
// file in scope. Automation (sdk-cli) sessions are left out and counted; folders
// already excluded as automation count all their sessions.
export function sessionInventory(listing) {
  const sessions = [];
  let automation = listing.excluded.filter((e) => e.reason === 'automation').reduce((n, e) => n + e.sessions, 0);
  let total = automation;
  for (const p of listing.projects) {
    for (const f of p.files ?? []) {
      total++;
      const meta = sampleMeta(f.path);
      if (meta?.entrypoint === 'sdk-cli') {
        automation++;
        continue;
      }
      sessions.push({
        id: basename(f.path, '.jsonl'),
        path: f.path,
        project: p.name,
        root: p.root,
        bytes: f.bytes,
        mtime: f.mtime,
        version: meta?.version ?? null,
        subagent_files: subagentFiles(f.path).map((s) => s.path),
      });
    }
  }
  sessions.sort((a, b) => a.mtime - b.mtime || a.id.localeCompare(b.id));
  const newest = [...sessions].reverse().find((s) => s.version);
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
  return {
    sessions,
    automation: { count: automation, total, share: total ? Math.round((automation / total) * 1000) / 1000 : 0 },
    harness_version: newest?.version ?? null,
    from: iso(sessions[0]?.mtime),
    to: iso(sessions.at(-1)?.mtime),
  };
}

// Keeps only the session files in `paths` (the set itemized at Gate A); projects
// left with no file drop out. Counts and sizes are recomputed from what remains.
export function freezeListing(listing, paths) {
  const projects = listing.projects
    .map((p) => {
      const files = (p.files ?? []).filter((f) => paths.has(f.path));
      const bytes = files.reduce((n, f) => n + f.bytes, 0);
      return { ...p, files, sessions: files.length, bytes, bytes_with_subagents: Math.max(bytes, (p.bytes_with_subagents ?? 0) - (p.bytes - bytes)) };
    })
    .filter((p) => p.files.length > 0);
  return { ...listing, projects, top: projects.slice(0, DEFAULT_VIEW), more: Math.max(0, projects.length - DEFAULT_VIEW) };
}
