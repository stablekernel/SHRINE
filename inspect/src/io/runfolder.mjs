// The only writer. Writes inside one run folder under the state dir, plus the
// marker files that let purge prove a folder belongs to this tool.
import fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { record } from './fsread.mjs';
import { InspectError } from '../cli/errors.mjs';

const MARKER = '.shrine-inspect';

// The marker goes only into a folder this tool created or found empty, so a state
// dir pointed at an existing folder with content is never claimed (and so never purged).
function ensureOwnedDir(dir) {
  const existedWithContent = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  fs.mkdirSync(dir, { recursive: true });
  const marker = join(dir, MARKER);
  if (!fs.existsSync(marker) && !existedWithContent) {
    fs.writeFileSync(marker, 'created by shrine-inspect\n');
    record({ op: 'write', path: marker, mode: 'w' });
  }
}

export function createRunFolder(stateDir, runId) {
  ensureOwnedDir(stateDir);
  const dir = resolve(stateDir, 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  record({ op: 'write', path: dir, mode: 'w' });
  return runFolder(dir);
}

export function runFolder(dir) {
  const root = resolve(dir);
  const inside = (rel) => {
    const p = resolve(root, rel);
    if (p !== root && !p.startsWith(root + sep)) {
      throw new InspectError('E_OUTSIDE_RUN_FOLDER', `refused to write outside the run folder: ${rel}`);
    }
    return p;
  };
  const write = (rel, content) => {
    const p = inside(rel);
    fs.writeFileSync(p, content);
    record({ op: 'write', path: p, mode: 'w' });
    return p;
  };
  return {
    dir: root,
    path: (rel) => inside(rel),
    write,
    writeJson: (rel, obj) => write(rel, `${JSON.stringify(obj, null, 2)}\n`),
    append(rel, line) {
      const p = inside(rel);
      fs.appendFileSync(p, line.endsWith('\n') ? line : `${line}\n`);
      record({ op: 'write', path: p, mode: 'a' });
    },
    // An empty folder inside the run folder (the judge's working directory).
    workDir(rel) {
      const p = inside(rel);
      fs.mkdirSync(p, { recursive: true });
      record({ op: 'write', path: p, mode: 'w' });
      return p;
    },
    // Exclusive create: false if the file already exists (another runner won).
    claim(rel, content) {
      const p = inside(rel);
      try {
        fs.writeFileSync(p, content, { flag: 'wx' });
      } catch (e) {
        if (e.code === 'EEXIST') return false;
        throw e;
      }
      record({ op: 'write', path: p, mode: 'w' });
      return true;
    },
    remove(rel) {
      const p = inside(rel);
      if (!fs.existsSync(p)) return;
      fs.rmSync(p, { force: true });
      record({ op: 'write', path: p, mode: 'rm' });
    },
    markDone: (phase) => write(`${phase}.done`, `${new Date().toISOString()}\n`),
    isDone: (phase) => fs.existsSync(inside(`${phase}.done`)),
  };
}

// Deletes state and cache folders, but only those holding this tool's marker.
export function purge(dirs) {
  const removed = [];
  const skipped = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    if (!fs.existsSync(join(dir, MARKER))) {
      skipped.push(dir);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    record({ op: 'write', path: dir, mode: 'rm' });
    removed.push(dir);
  }
  return { removed, skipped };
}
