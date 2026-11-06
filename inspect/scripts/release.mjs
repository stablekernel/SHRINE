// Release packaging (plan T3.3): builds dist/shrine-inspect-<version>.tgz, a
// pinned install.sh, and SHA256SUMS. Deterministic and offline: the tarball is
// written here (ustar, sorted entries, fixed owner, modes, and mtime; gzip with
// no name or time and a fixed OS byte), so the same tree and the same Node give
// the same bytes on any machine. No network, no git, no npm.
//
//   node scripts/release.mjs [--out <dir>]
//
// Contents: package.json `files` entries, a package.json without scripts or
// devDependencies, and the repo root LICENSE and NOTICE. Dev files never ship.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = resolve(PKG_ROOT, '..');
// 2026-01-01T00:00:00Z, or SOURCE_DATE_EPOCH when set (reproducible-builds.org).
export const DEFAULT_MTIME = 1767225600;
const SKIP = new Set(['.DS_Store', 'Thumbs.db']);
const EXECUTABLE = /^bin\/[^/]+\.mjs$/;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Every file under a `files` entry, as [relative path, absolute path], sorted.
function collect(pkgRoot, entries) {
  const out = [];
  const walk = (abs) => {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) throw new Error(`release: refusing a symlink: ${relative(pkgRoot, abs)}`);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) if (!SKIP.has(name)) walk(join(abs, name));
    } else if (st.isFile()) out.push([relative(pkgRoot, abs).split(sep).join('/'), abs]);
  };
  for (const e of entries) {
    const abs = join(pkgRoot, e);
    if (!existsSync(abs)) throw new Error(`release: package.json files entry is missing: ${e}`);
    walk(abs);
  }
  return out;
}

// One ustar header block. Long names go in the prefix field (split at a slash).
function header({ name, size, mode, type, mtime }) {
  const b = Buffer.alloc(512, 0);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', name.length - 1 - (name.endsWith('/') ? 1 : 0));
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`release: path too long for ustar: ${prefix}/${name}`);
  }
  const put = (s, off, len) => b.write(s, off, Math.min(len, Buffer.byteLength(s)), 'utf8');
  const oct = (n, off, len) => put(`${n.toString(8).padStart(len - 1, '0')}\0`, off, len);
  put(name, 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8);
  oct(0, 116, 8);
  oct(size, 124, 12);
  oct(mtime, 136, 12);
  b.fill(0x20, 148, 156);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const x of b) sum += x;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return b;
}

// entries: [{ path, data }] for files; parent folders are added. Returns tar bytes.
export function tar(entries, { mtime = DEFAULT_MTIME } = {}) {
  const dirs = new Set();
  for (const e of entries) {
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(`${parts.slice(0, i).join('/')}/`);
  }
  const all = [...[...dirs].map((d) => ({ path: d, dir: true })), ...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const blocks = [];
  for (const e of all) {
    if (e.dir) {
      blocks.push(header({ name: e.path, size: 0, mode: 0o755, type: '5', mtime }));
      continue;
    }
    blocks.push(header({ name: e.path, size: e.data.length, mode: e.mode ?? 0o644, type: '0', mtime }));
    blocks.push(e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

// gzip with no file name and mtime 0 (zlib's default), and the OS byte fixed to
// 3 (Unix): zlib otherwise writes the build platform there.
export function gzip(buf) {
  const z = gzipSync(buf, { level: 9 });
  z[9] = 3;
  return z;
}

// The shipped package.json: no scripts (they name dev files) and no devDependencies.
export function releasePackageJson(pkg) {
  const rest = Object.fromEntries(Object.entries(pkg).filter(([k]) => k !== 'scripts' && k !== 'devDependencies'));
  return `${JSON.stringify(rest, null, 2)}\n`;
}

export function buildRelease({ pkgRoot = PKG_ROOT, repoRoot = REPO_ROOT, out = join(PKG_ROOT, 'dist'), mtime = Number(process.env.SOURCE_DATE_EPOCH) || DEFAULT_MTIME } = {}) {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version)) throw new Error(`release: bad version ${pkg.version}`);
  const top = `${pkg.name}-${pkg.version}`;
  const entries = collect(pkgRoot, pkg.files).map(([rel, abs]) => ({ path: `${top}/${rel}`, data: readFileSync(abs), mode: EXECUTABLE.test(rel) ? 0o755 : 0o644 }));
  if (entries.some((e) => /\/(test|node_modules|dist)\//.test(e.path))) throw new Error('release: dev files in the files list');
  entries.push({ path: `${top}/package.json`, data: Buffer.from(releasePackageJson(pkg)) });
  for (const f of ['LICENSE', 'NOTICE']) entries.push({ path: `${top}/${f}`, data: readFileSync(join(repoRoot, f)) });
  const tgz = gzip(tar(entries, { mtime }));
  const tgzName = `${top}.tgz`;
  const tgzSha = sha256(tgz);
  const install = readFileSync(join(pkgRoot, 'scripts', 'install.sh'), 'utf8').replace('PINNED_VERSION=""', `PINNED_VERSION="${pkg.version}"`).replace('PINNED_SHA256=""', `PINNED_SHA256="${tgzSha}"`);
  if (!install.includes(tgzSha)) throw new Error('release: install.sh has no PINNED_SHA256 line to pin');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, tgzName), tgz);
  writeFileSync(join(out, 'install.sh'), install);
  chmodSync(join(out, 'install.sh'), 0o755);
  const sums = [[tgzName, tgzSha], ['install.sh', sha256(Buffer.from(install))]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  writeFileSync(join(out, 'SHA256SUMS'), sums.map(([n, h]) => `${h}  ${n}\n`).join(''));
  return { version: pkg.version, out, tarball: join(out, tgzName), sha256: tgzSha, install: join(out, 'install.sh'), sums: join(out, 'SHA256SUMS'), files: entries.map((e) => e.path).sort() };
}

if (process.argv[1] && basename(process.argv[1]) === 'release.mjs') {
  const i = process.argv.indexOf('--out');
  const r = buildRelease(i > 0 ? { out: resolve(process.argv[i + 1]) } : {});
  process.stdout.write(`${relative(process.cwd(), r.tarball) || r.tarball}\n${r.sha256}  ${basename(r.tarball)}\n${r.files.length} files; SHA256SUMS and install.sh in ${r.out}\n`);
}
