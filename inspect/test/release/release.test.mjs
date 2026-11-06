// Release packaging (plan T3.3): the tarball holds the CLI, the skill wrapper,
// the catalogue, LICENSE, and NOTICE, and no dev files; two builds give the same
// bytes; SHA256SUMS and the pinned install.sh match the tarball; system tar
// reads it. No network anywhere in the build or the installer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildRelease, sha256, tar } from '../../scripts/release.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const TOP = `shrine-inspect-${PKG.version}`;

// Minimal ustar reader: [{ name, type, mode, size, mtime, data }].
export function untar(buf) {
  const out = [];
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
    const num = (a, n) => Number.parseInt(str(a, n).trim() || '0', 8);
    const prefix = str(345, 155);
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const size = num(124, 12);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    assert.equal(num(148, 8), sum, `checksum of ${name}`);
    out.push({ name, type: str(156, 1), mode: num(100, 8), size, mtime: num(136, 12), uid: num(108, 8), magic: str(257, 6), data: buf.subarray(off + 512, off + 512 + size) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const built = (() => {
  let r = null;
  return () => (r ??= buildRelease({ out: mkdtempSync(join(tmpdir(), 'si-rel-')) }));
})();

test('tarball contents: CLI, skill wrapper, catalogue, LICENSE, NOTICE; no dev files', () => {
  const r = built();
  const entries = untar(gunzipSync(readFileSync(r.tarball)));
  const names = entries.map((e) => e.name);
  for (const want of ['bin/shrine-inspect.mjs', 'src/cli/main.mjs', 'src/catalogue/catalogue.json', 'skill/.claude-plugin/plugin.json', 'skill/skills/shrine-inspect/SKILL.md', 'LICENSE', 'NOTICE', 'package.json', 'README.md', 'TRIAL.md']) {
    assert.ok(names.includes(`${TOP}/${want}`), want);
  }
  assert.ok(names.every((n) => n.startsWith(`${TOP}/`)), 'one top folder');
  for (const n of names) assert.doesNotMatch(n, /\/(test|scripts|node_modules|dist)\/|playwright|package-lock|\.DS_Store/, n);
  assert.equal(entries.find((e) => e.name === `${TOP}/bin/shrine-inspect.mjs`).mode, 0o755);
  for (const e of entries) {
    const want = e.type === '5' || e.name === `${TOP}/bin/shrine-inspect.mjs` ? 0o755 : 0o644;
    assert.equal(e.mode, want, e.name);
  }
  assert.ok(entries.every((e) => e.uid === 0 && e.magic === 'ustar' && e.mtime === 1767225600));
  const shipped = JSON.parse(entries.find((e) => e.name === `${TOP}/package.json`).data.toString('utf8'));
  assert.equal(shipped.license, 'Apache-2.0');
  for (const k of ['author', 'repository', 'homepage', 'bugs']) assert.ok(shipped[k], k);
  assert.equal(shipped.devDependencies, undefined);
  assert.equal(shipped.scripts, undefined);
  assert.equal(shipped.version, PKG.version);
  const license = entries.find((e) => e.name === `${TOP}/LICENSE`).data.toString('utf8');
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.equal(license, readFileSync(join(ROOT, '..', 'LICENSE'), 'utf8'));
  // Every file under src/ and bin/ ships, byte for byte.
  const src = spawnSync('git', ['ls-files', 'bin', 'src', 'skill'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n');
  for (const f of src) assert.deepEqual(entries.find((e) => e.name === `${TOP}/${f}`)?.data, readFileSync(join(ROOT, f)), f);
});

test('two builds give the same bytes; SHA256SUMS and the pinned install.sh match', () => {
  const a = built();
  const b = buildRelease({ out: mkdtempSync(join(tmpdir(), 'si-rel-')) });
  assert.deepEqual(readFileSync(a.tarball), readFileSync(b.tarball));
  assert.equal(readFileSync(a.sums, 'utf8'), readFileSync(b.sums, 'utf8'));
  const sums = Object.fromEntries(readFileSync(a.sums, 'utf8').trim().split('\n').map((l) => l.split('  ').reverse()));
  assert.deepEqual(Object.keys(sums).sort(), ["install.sh", `${TOP}.tgz`]);
  assert.equal(sums[`${TOP}.tgz`], sha256(readFileSync(a.tarball)));
  assert.equal(sums['install.sh'], sha256(readFileSync(a.install)));
  const install = readFileSync(a.install, 'utf8');
  assert.match(install, new RegExp(`^PINNED_SHA256="${a.sha256}"$`, 'm'));
  assert.match(install, new RegExp(`^PINNED_VERSION="${PKG.version.replaceAll('.', '\\.')}"$`, 'm'));
  // The gzip header names no file and no time, and fixes the OS byte.
  const gz = readFileSync(a.tarball);
  assert.equal(gz[3], 0, 'no FNAME');
  assert.equal(gz.readUInt32LE(4), 0, 'mtime 0');
  assert.equal(gz[9], 3, 'OS byte 3');
});

test('system tar reads the tarball and SHA256SUMS verifies with the system tool', { skip: process.platform === 'win32' && 'POSIX tools' }, () => {
  const r = built();
  const listed = spawnSync('tar', ['-tzf', r.tarball], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(listed.stdout.includes(`${TOP}/bin/shrine-inspect.mjs`));
  const tool = spawnSync('sh', ['-c', 'command -v sha256sum >/dev/null && echo sha256sum || echo "shasum -a 256"'], { encoding: 'utf8' }).stdout.trim();
  const check = spawnSync('sh', ['-c', `${tool} -c SHA256SUMS`], { cwd: r.out, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, new RegExp(`${TOP}\\.tgz: OK`));
});

test('ustar writer: long paths use the prefix field; sizes pad to 512', () => {
  const long = `${'a'.repeat(60)}/${'b'.repeat(60)}/c.txt`;
  const entries = untar(tar([{ path: long, data: Buffer.from('x') }], { mtime: 1 }));
  assert.deepEqual(entries.map((e) => [e.name, e.type]), [[`${'a'.repeat(60)}/`, '5'], [`${'a'.repeat(60)}/${'b'.repeat(60)}/`, '5'], [long, '0']]);
  assert.equal(entries.at(-1).data.toString(), 'x');
});

test('the build and the installer use no network', () => {
  for (const f of ['scripts/release.mjs', 'scripts/install.sh']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /\b(curl|wget|fetch\(|https?\.get|node:https?|node:net)\b/, f);
  }
});
