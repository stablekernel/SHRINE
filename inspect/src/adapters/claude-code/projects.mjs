// Project listing for Gate A (spec 3 phase 1, spec 10 adapter). Before consent it
// reads filesystem metadata plus, from one session file per folder, the cwd,
// entrypoint, and version keys within the first 10 lines. A folder whose newest
// file is sdk-cli is excluded as automation; its files are re-checked after consent.
//
// Session classes, after consent: interactive (read for usage), housekeeping
// (sdk-cli whose first prompt starts with a known prefix; counted only; a boolean,
// no prompt text is kept), spawned (other sdk-cli work, linked to a parent session
// as a byproduct, never judged).
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, list, readJson, readLines, stat } from '../../io/fsread.mjs';
import { gitOut } from '../../io/git.mjs';
import { userText } from './human-turn.mjs';

const TEMP = readJson(fileURLToPath(new URL('../../probes/patterns/temp-folder.json', import.meta.url)));
export const HOUSEKEEPING = readJson(fileURLToPath(new URL('../../probes/patterns/housekeeping.json', import.meta.url)));
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

// consented: false (Gate A) returns only cwd, entrypoint, and version, with kind
// 'automation' for any sdk-cli file. consented: true also reads the start time and
// the first prompt, to tell housekeeping from spawned work.
function sampleMeta(file, { consented = false, prefixes = HOUSEKEEPING.prefixes } = {}) {
  const s = (v) => (typeof v === 'string' ? v : null);
  let meta = null;
  let firstPrompt = null;
  let start = null;
  for (const line of readLines(file, MAX_CWD_LINES)) {
    if (!line.includes('"cwd"') && !(consented && line.includes('"type":"user"'))) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // a corrupt line is skipped; the next one may carry cwd
    }
    if (!meta && typeof o.cwd === 'string') meta = { cwd: o.cwd, entrypoint: s(o.entrypoint), version: s(o.version) };
    if (!consented) {
      if (meta) break;
      continue;
    }
    if (!start && typeof o.timestamp === 'string') start = o.timestamp;
    if (firstPrompt === null && o.type === 'user' && !o.toolUseResult) firstPrompt = userText(o).trimStart();
    if (meta && firstPrompt !== null) break;
  }
  if (!meta) return null;
  if (meta.entrypoint !== 'sdk-cli') return { ...meta, start, kind: 'interactive' };
  if (!consented) return { ...meta, start, kind: 'automation' };
  const housekeeping = firstPrompt !== null && prefixes.some((p) => firstPrompt.startsWith(p));
  return { ...meta, start, kind: housekeeping ? 'housekeeping' : 'spawned' };
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
      excluded.push({ folder: folder.name, cwd: meta.cwd, reason: 'temp', sessions: files.length, bytes, files });
      continue;
    }
    if (meta.kind === 'automation') {
      // Kept so that, after consent, every file here is re-checked one by one.
      excluded.push({ folder: folder.name, cwd: meta.cwd, reason: 'automation', sessions: files.length, bytes, files });
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

// After Gate A consent: classifies every session file in scope, plus every file
// in folders excluded as automation (a mixed folder keeps its interactive
// sessions). Only interactive sessions are returned for reading.
export function sessionInventory(listing) {
  const sessions = [];
  const spawned = [];
  let housekeeping = 0;
  let total = 0;
  const roots = new Map();
  const rootOf = (cwd) => {
    if (!roots.has(cwd)) roots.set(cwd, repoRoot(cwd));
    return roots.get(cwd);
  };
  const groups = [
    ...listing.projects.map((p) => ({ files: p.files ?? [], project: p })),
    ...listing.excluded.filter((e) => e.reason === 'automation').map((e) => ({ files: e.files ?? [], project: null })),
    // Temp and scratch folders: only their sdk-cli files are classified; interactive
    // sessions there stay unread.
    ...listing.excluded.filter((e) => e.reason === 'temp').map((e) => ({ files: e.files ?? [], project: null, temp: true })),
  ];
  for (const g of groups) {
    for (const f of g.files) {
      total++;
      const meta = sampleMeta(f.path, { consented: true });
      const id = basename(f.path, '.jsonl');
      const root = g.project?.root ?? (meta ? rootOf(meta.cwd) : null);
      if (meta?.kind === 'housekeeping') {
        housekeeping++;
        continue;
      }
      if (meta?.kind === 'spawned') {
        spawned.push({ id, root, temp: Boolean(g.temp), start: meta.start ?? new Date(f.mtime).toISOString() });
        continue;
      }
      if (g.temp) {
        total--;
        continue;
      }
      if (!root) continue;
      sessions.push({
        id,
        path: f.path,
        project: g.project?.name ?? basename(root),
        root,
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
    spawned,
    automation: { housekeeping, spawned: spawned.length, total, share: total ? Math.round((housekeeping / total) * 1000) / 1000 : 0 },
    harness_version: newest?.version ?? null,
    from: iso(sessions[0]?.mtime),
    to: iso(sessions.at(-1)?.mtime),
  };
}

// Links spawned sdk-cli sessions to the interactive session that most likely
// started them: one running at that time (5 minutes of slack) in the same repo
// root, latest start first. A spawned session in a temp or scratch folder has no
// repo of its own, so time alone decides. Returns {parents, linked, unattributed}.
export function linkSpawned(spawned, sessions, slackMs = 5 * 60000) {
  const parents = new Map();
  let linked = 0;
  for (const sp of spawned) {
    const t = Date.parse(sp.start);
    const parent = sessions
      .filter((s) => (sp.temp || s.root === sp.root) && Date.parse(s.start) - slackMs <= t && t <= Date.parse(s.end) + slackMs)
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
    if (!parent) continue;
    linked++;
    parents.set(parent.id, (parents.get(parent.id) ?? 0) + 1);
  }
  return { parents, linked, unattributed: spawned.length - linked };
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
  const excluded = listing.excluded.map((e) => (e.files ? { ...e, files: e.files.filter((f) => paths.has(f.path)) } : e));
  return { ...listing, excluded, projects, top: projects.slice(0, DEFAULT_VIEW), more: Math.max(0, projects.length - DEFAULT_VIEW) };
}
