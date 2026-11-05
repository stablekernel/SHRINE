// inventory(): every config source Claude Code loads (spec 2, spec 10 adapter),
// each with path, bytes, mtime, sha256, and source. Plugin-shipped hooks, skills,
// agents, commands, and servers count with source "plugin". The tool's own skill
// is excluded so it never hides a stack gap.
import { dirname, join, relative } from 'node:path';
import { exists, isDir, list, readBytes, sha256, stat } from '../../io/fsread.mjs';
import { claudeHomeOf } from './detect.mjs';
import { encodeProjectPath } from './projects.mjs';
import { resolveImports } from './always-loaded.mjs';

export const OWN_SKILL = 'shrine-inspect';

export function managedSettingsPath(platform = process.platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (platform === 'win32') return 'C:\\ProgramData\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.worktrees', 'dist', 'build', 'vendor', 'target', '.venv', 'venv']);

export function inventory({ home, projects = [], managedPath = managedSettingsPath() }) {
  const claudeHome = claudeHomeOf(home);
  const items = [];
  const seen = new Set();
  const permissions = { allow: [], ask: [], deny: [], defaultMode: null, skipDangerousModePermissionPrompt: null };
  const settings = [];
  const enabledPlugins = new Map();

  const addFile = (path, kind, layer, source, loaded_by, extra = {}) => {
    if (seen.has(path)) return null;
    const s = stat(path);
    if (!s || !s.isFile()) return null;
    seen.add(path);
    const buf = readBytes(path);
    const item = { id: `cfg-${items.length + 1}`, path, kind, layer, source, loaded_by, bytes: s.size, mtime: s.mtime.toISOString(), mtime_ms: s.mtimeMs, sha256: sha256(buf), ...extra };
    item.text = kind === 'instruction' || kind === 'memory' ? buf.toString('utf8') : undefined;
    items.push(item);
    return { item, buf };
  };
  const addVirtual = (path, key, kind, layer, source, loaded_by, value) => {
    items.push({
      id: `cfg-${items.length + 1}`,
      path: `${path}#${key}`,
      kind,
      layer,
      source,
      loaded_by,
      bytes: Buffer.byteLength(JSON.stringify(value) ?? ''),
      mtime: null,
      sha256: sha256(Buffer.from(JSON.stringify(value) ?? '')),
      virtual: true,
    });
  };
  const addHooks = (hooks, path, layer, source, loaded_by) => {
    if (!hooks || typeof hooks !== 'object') return;
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((e, i) => addVirtual(path, `hooks.${event}[${i}]`, 'hook', layer, source, loaded_by, e));
    }
  };
  const addServers = (servers, path, layer, source, loaded_by) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, def] of Object.entries(servers)) addVirtual(path, `mcpServers.${name}`, 'server', layer, source, loaded_by, def);
  };
  const addSettings = (path, layer, source) => {
    const r = addFile(path, 'settings', layer, source, 'harness');
    if (!r) return;
    let json;
    try {
      json = JSON.parse(r.buf.toString('utf8'));
    } catch {
      r.item.parse_error = true;
      return;
    }
    settings.push({ path, layer, source, json });
    addHooks(json.hooks, path, layer, source, 'settings');
    const p = json.permissions ?? {};
    for (const list of ['allow', 'ask', 'deny']) {
      for (const rule of Array.isArray(p[list]) ? p[list] : []) permissions[list].push({ rule, path, source, layer });
    }
    if (Object.keys(p).length) addVirtual(path, 'permissions', 'permission', layer, source, 'settings', p);
    if (typeof p.defaultMode === 'string' && layer !== 'project') permissions.defaultMode = { value: p.defaultMode, path, source };
    else if (typeof p.defaultMode === 'string' && !permissions.defaultMode) permissions.defaultMode = { value: p.defaultMode, path, source };
    if (json.skipDangerousModePermissionPrompt === true) permissions.skipDangerousModePermissionPrompt = { value: true, path, source };
    for (const [name, on] of Object.entries(json.enabledPlugins ?? {})) {
      if (on === true) enabledPlugins.set(name, source);
      else if (on === false) enabledPlugins.delete(name);
    }
  };
  const addMarkdownDir = (dir, kind, layer, source, loaded_by, { recursive = false } = {}) => {
    for (const e of list(dir)) {
      const p = join(dir, e.name);
      if (e.dir && recursive) addMarkdownDir(p, kind, layer, source, loaded_by, { recursive });
      else if (!e.dir && e.name.endsWith('.md')) addFile(p, kind, layer, source, loaded_by);
    }
  };
  const addSkills = (dir, layer, source, loaded_by) => {
    for (const e of list(dir).filter((x) => x.dir && x.name !== OWN_SKILL)) {
      addFile(join(dir, e.name, 'SKILL.md'), 'skill', layer, source, loaded_by);
    }
  };
  const addMcpJson = (path, layer, source, loaded_by) => {
    const r = addFile(path, 'server', layer, source, loaded_by);
    if (!r) return;
    try {
      addServers(JSON.parse(r.buf.toString('utf8')).mcpServers, path, layer, source, loaded_by);
    } catch {
      r.item.parse_error = true;
    }
  };

  // Managed (org) settings, then user.
  if (managedPath) addSettings(managedPath, 'org', 'managed');
  addSettings(join(claudeHome, 'settings.json'), 'user', 'user');
  addSettings(join(claudeHome, 'settings.local.json'), 'local', 'local');
  addFile(join(claudeHome, 'CLAUDE.md'), 'instruction', 'user', 'user', 'always');
  addMarkdownDir(join(claudeHome, 'rules'), 'instruction', 'user', 'user', 'always', { recursive: true });
  addMarkdownDir(join(claudeHome, 'output-styles'), 'instruction', 'user', 'user', 'output-style');
  addMarkdownDir(join(claudeHome, 'agents'), 'agent', 'user', 'user', 'on-demand', { recursive: true });
  addMarkdownDir(join(claudeHome, 'commands'), 'command', 'user', 'user', 'on-demand', { recursive: true });
  addSkills(join(claudeHome, 'skills'), 'user', 'user', 'on-demand');

  // User-scope servers live in ~/.claude.json beside harness state; only the
  // mcpServers subtree is config, so only it is hashed.
  const claudeJson = join(home, '.claude.json');
  if (exists(claudeJson)) {
    try {
      const j = JSON.parse(readBytes(claudeJson).toString('utf8'));
      addServers(j.mcpServers, claudeJson, 'user', 'user', 'user-servers');
    } catch {
      // harness state file unreadable; servers unknown
    }
  }

  // Projects in scope.
  for (const p of projects) {
    const root = p.root;
    addFile(join(root, 'CLAUDE.md'), 'instruction', 'project', 'project', 'always');
    addFile(join(root, '.claude', 'CLAUDE.md'), 'instruction', 'project', 'project', 'always');
    addFile(join(root, 'CLAUDE.local.md'), 'instruction', 'local', 'local', 'always');
    addSettings(join(root, '.claude', 'settings.json'), 'project', 'project');
    addSettings(join(root, '.claude', 'settings.local.json'), 'local', 'local');
    addMarkdownDir(join(root, '.claude', 'rules'), 'instruction', 'project', 'project', 'always', { recursive: true });
    addMarkdownDir(join(root, '.claude', 'agents'), 'agent', 'project', 'project', 'on-demand', { recursive: true });
    addMarkdownDir(join(root, '.claude', 'commands'), 'command', 'project', 'project', 'on-demand', { recursive: true });
    addSkills(join(root, '.claude', 'skills'), 'project', 'project', 'on-demand');
    addMcpJson(join(root, '.mcp.json'), 'project', 'project', 'project-servers');
    for (const nested of nestedInstructionFiles(root)) addFile(nested, 'instruction', 'project', 'project', 'nested');
    for (const cwd of new Set([root, ...(p.cwds ?? [])])) {
      addMarkdownDir(join(claudeHome, 'projects', encodeProjectPath(cwd), 'memory'), 'memory', 'user', 'user', 'auto-memory');
    }
  }

  // Files pulled in by @ imports are instruction sources too (the list grows as we go).
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'instruction' || !it.text || (it.import_depth ?? 0) >= 5) continue;
    for (const p of resolveImports(it.text, dirname(it.path), home)) {
      const r = addFile(p, 'instruction', it.layer, it.source, 'import');
      if (r) r.item.import_depth = (it.import_depth ?? 0) + 1;
    }
  }

  // Enabled plugins and what each ships.
  const installed = readInstalledPlugins(claudeHome);
  for (const name of [...enabledPlugins.keys()].sort()) {
    const dir = installed[name];
    if (!dir || !isDir(dir)) continue;
    const by = `plugin:${name}`;
    const hooksJson = join(dir, 'hooks', 'hooks.json');
    const r = addFile(hooksJson, 'settings', 'user', 'plugin', by);
    if (r) {
      try {
        const j = JSON.parse(r.buf.toString('utf8'));
        addHooks(j.hooks ?? j, hooksJson, 'user', 'plugin', by);
      } catch {
        r.item.parse_error = true;
      }
    }
    addSkills(join(dir, 'skills'), 'user', 'plugin', by);
    addMarkdownDir(join(dir, 'agents'), 'agent', 'user', 'plugin', by, { recursive: true });
    addMarkdownDir(join(dir, 'commands'), 'command', 'user', 'plugin', by, { recursive: true });
    addMcpJson(join(dir, '.mcp.json'), 'user', 'plugin', by);
  }

  const userSettings = settings.find((s) => s.layer === 'user')?.json ?? {};
  return {
    claude_home: claudeHome,
    items,
    permissions,
    settings,
    enabled_plugins: [...enabledPlugins.keys()].sort(),
    output_style: userSettings.outputStyle ?? null,
  };
}

function readInstalledPlugins(claudeHome) {
  const path = join(claudeHome, 'plugins', 'installed_plugins.json');
  if (!exists(path)) return {};
  try {
    const j = JSON.parse(readBytes(path).toString('utf8'));
    const out = {};
    for (const [name, v] of Object.entries(j.plugins ?? {})) {
      const entry = Array.isArray(v) ? v[0] : v;
      if (entry?.installPath) out[name] = entry.installPath;
    }
    return out;
  } catch {
    return {};
  }
}

// CLAUDE.md files below the repo root (loaded when the agent works in that folder).
function nestedInstructionFiles(root, depth = 0, dir = root) {
  if (depth > 6) return [];
  const out = [];
  for (const e of list(dir)) {
    if (e.dir) {
      if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.claude')) continue;
      if (dir === root && e.name === '.claude') continue;
      out.push(...nestedInstructionFiles(root, depth + 1, join(dir, e.name)));
    } else if (dir !== root && e.name === 'CLAUDE.md') {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

export function relativeTo(root, path) {
  return relative(root, path).split('\\').join('/');
}
