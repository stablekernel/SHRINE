// alwaysLoaded(): bytes loaded into every session, per project in scope: user and
// project CLAUDE.md chain with @ imports resolved, ~/.claude/rules, the active
// output style, and the project's auto-loaded MEMORY.md. Skills and agents load
// on demand, so they are excluded.
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { exists, readText, stat } from '../../io/fsread.mjs';
import { claudeHomeOf } from './detect.mjs';
import { encodeProjectPath } from './projects.mjs';

const MAX_IMPORT_DEPTH = 5;

// @path tokens outside code fences and inline code, preceded by start or space.
export function resolveImports(text, baseDir, home) {
  const out = [];
  let fence = false;
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const line = raw.replace(/`[^`]*`/g, '');
    for (const m of line.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w.\-/]+)/g)) {
      let p = m[1].replace(/[.,;:)]+$/, '');
      if (!/[./]/.test(p)) continue;
      if (p.startsWith('~/')) p = join(home, p.slice(2));
      else if (!isAbsolute(p)) p = resolve(baseDir, p);
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

function withImports(path, home, seen, depth = 0) {
  if (seen.has(path) || !exists(path) || !stat(path).isFile()) return [];
  seen.add(path);
  const files = [{ path, bytes: stat(path).size }];
  if (depth >= MAX_IMPORT_DEPTH) return files;
  for (const imp of resolveImports(readText(path), dirname(path), home)) {
    files.push(...withImports(imp, home, seen, depth + 1));
  }
  return files;
}

function outputStyleFile(inv) {
  if (!inv.output_style) return null;
  const want = String(inv.output_style).toLowerCase();
  const styles = inv.items.filter((i) => i.loaded_by === 'output-style');
  const hit = styles.find((s) => {
    const name = s.text?.match(/^name:\s*(.+)$/m)?.[1]?.trim().toLowerCase();
    const file = s.path.split('/').pop().replace(/\.md$/, '').toLowerCase();
    return name === want || file === want || file === want.replace(/\s+/g, '-');
  });
  return hit?.path ?? null;
}

export function alwaysLoaded({ home, projects = [], inventory: inv }) {
  const claudeHome = claudeHomeOf(home);
  const userSeen = new Set();
  const user = withImports(join(claudeHome, 'CLAUDE.md'), home, userSeen);
  for (const r of inv.items.filter((i) => i.loaded_by === 'always' && i.layer === 'user' && i.path.startsWith(join(claudeHome, 'rules')))) {
    user.push(...withImports(r.path, home, userSeen));
  }
  const style = outputStyleFile(inv);
  if (style) user.push(...withImports(style, home, userSeen));

  const by_project = projects.map((p) => {
    const seen = new Set(userSeen);
    const files = [...user];
    for (const f of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) files.push(...withImports(join(p.root, f), home, seen));
    for (const r of inv.items.filter((i) => i.loaded_by === 'always' && i.path.startsWith(join(p.root, '.claude', 'rules')))) {
      files.push(...withImports(r.path, home, seen));
    }
    const memory = join(claudeHome, 'projects', encodeProjectPath(p.root), 'memory', 'MEMORY.md');
    files.push(...withImports(memory, home, seen, MAX_IMPORT_DEPTH));
    return { project: p.root, bytes: files.reduce((n, f) => n + f.bytes, 0), files };
  });
  const userBytes = user.reduce((n, f) => n + f.bytes, 0);
  const max = by_project.reduce((m, p) => Math.max(m, p.bytes), userBytes);
  return { user_bytes: userBytes, user_files: user, by_project, max_bytes: max };
}
