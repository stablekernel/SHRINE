// The only module that reads the filesystem. Opens read-only and records every
// open, stat, and directory listing in the spy log (spec 7, read-only proof).
import fs from 'node:fs';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { InspectError } from '../cli/errors.mjs';

const log = [];

export function spyLog() {
  return log.slice();
}

export function resetSpy() {
  log.length = 0;
}

// Other IO modules (git, proc, runfolder) append their own entries here.
export function record(entry) {
  log.push({ ...entry, t: Date.now() });
}

// tag: extra spy fields, e.g. {bounded: true} for readLines.
export function open(path, mode = 'r', tag = {}) {
  if (mode !== 'r') throw new InspectError('E_WRITE_MODE', `refused to open ${path} in mode ${mode}`);
  record({ ...tag, op: 'open', path, mode: 'r' });
  return fs.openSync(path, 'r');
}

export function close(fd) {
  fs.closeSync(fd);
}

export function readBytes(path) {
  const fd = open(path);
  try {
    return fs.readFileSync(fd);
  } finally {
    close(fd);
  }
}

export function readText(path) {
  return readBytes(path).toString('utf8');
}

export function readJson(path) {
  return JSON.parse(readText(path));
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(path) {
  return sha256(readBytes(path));
}

// First maxLines lines, reading at most maxBytes; never the whole file. The spy
// entry is tagged bounded, so tests can tell it from a full read.
export function readLines(path, maxLines, maxBytes = 1 << 20) {
  const fd = open(path, 'r', { bounded: true });
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let text = '';
    let pos = 0;
    while (pos < maxBytes) {
      const n = fs.readSync(fd, chunk, 0, Math.min(chunk.length, maxBytes - pos), pos);
      if (n === 0) break;
      pos += n;
      text += chunk.subarray(0, n).toString('utf8');
      if (text.split('\n').length > maxLines) break;
    }
    return text.split('\n').slice(0, maxLines).filter((l, i, a) => l !== '' || i < a.length - 1);
  } finally {
    close(fd);
  }
}

// At most maxBytes from the start of a file, as text, and whether more was left.
export function readHead(path, maxBytes) {
  const fd = open(path);
  try {
    const buf = Buffer.alloc(maxBytes + 1);
    let pos = 0;
    while (pos < buf.length) {
      const n = fs.readSync(fd, buf, pos, buf.length - pos, pos);
      if (n === 0) break;
      pos += n;
    }
    return { text: buf.subarray(0, Math.min(pos, maxBytes)).toString('utf8'), truncated: pos > maxBytes };
  } finally {
    close(fd);
  }
}

// Streams a file line by line; never holds the whole file. The spy entry records
// the size at open, so later growth of an append-only log is attributable.
export async function* streamLines(path) {
  const s = fs.statSync(path);
  record({ op: 'open', path, mode: 'r', size: s.size, stream: true });
  const input = fs.createReadStream(path, { flags: 'r', encoding: 'utf8', highWaterMark: 1 << 16 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    input.destroy();
  }
}

export function stat(path) {
  record({ op: 'stat', path, mode: 'r' });
  try {
    return fs.statSync(path);
  } catch {
    return null;
  }
}

// Resolved path with symlinks followed, or null.
export function realpath(path) {
  record({ op: 'stat', path, mode: 'r' });
  try {
    return fs.realpathSync(path);
  } catch {
    return null;
  }
}

export function exists(path) {
  return stat(path) !== null;
}

export function isDir(path) {
  return stat(path)?.isDirectory() ?? false;
}

// Directory entries as {name, dir}; empty when the folder is missing.
export function list(path) {
  record({ op: 'list', path, mode: 'r' });
  try {
    return fs
      .readdirSync(path, { withFileTypes: true })
      .map((d) => ({ name: d.name, dir: d.isDirectory() || (d.isSymbolicLink() && isDirQuiet(`${path}/${d.name}`)) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

function isDirQuiet(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
