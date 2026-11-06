// Install path (plan T3.4): install.sh checks Node 20 or newer and the pinned
// SHA-256 before it extracts anything; a changed tarball installs nothing; the
// source copy (nothing pinned) refuses to run; --skill copies only the skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease } from '../../scripts/release.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const skip = process.platform === 'win32' && 'POSIX shell installer';

const release = (() => {
  let r = null;
  return () => (r ??= buildRelease({ out: mkdtempSync(join(tmpdir(), 'si-inst-rel-')) }));
})();
const freshHome = () => mkdtempSync(join(tmpdir(), 'si-inst-home-'));
// PATH: this Node first, then the system tools the script uses.
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;
const sh = (script, args, { home, path = PATH, cwd } = {}) => spawnSync('/bin/sh', [script, ...args], { cwd, encoding: 'utf8', env: { HOME: home, PATH: path } });

test('install: Node check, checksum, extract, link, version smoke test', { skip }, () => {
  const r = release();
  const home = freshHome();
  const out = sh(r.install, [], { home });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, new RegExp(`Checksum OK: ${r.sha256}`));
  assert.match(out.stdout, new RegExp(`shrine-inspect ${PKG.version.replaceAll('.', '\\.')}\\n`));
  const dest = join(home, '.local', 'share', 'shrine-inspect', PKG.version);
  const link = join(home, '.local', 'bin', 'shrine-inspect');
  assert.equal(readlinkSync(link), join(dest, 'bin', 'shrine-inspect.mjs'));
  for (const f of ['LICENSE', 'NOTICE', 'TRIAL.md', 'src/catalogue/catalogue.json']) assert.ok(existsSync(join(dest, f)), f);
  assert.deepEqual(readdirSync(join(home, '.local', 'share', 'shrine-inspect')), [PKG.version], 'no temp folder left');
  assert.ok(!existsSync(join(home, '.claude')), 'no skill without --skill');
  assert.match(out.stdout, /Add .*\.local\/bin to your PATH/);
  // Reinstalling the same version replaces it: the old copy goes only after the new one is in.
  writeFileSync(join(dest, 'stale.txt'), 'old');
  assert.equal(sh(r.install, [], { home }).status, 0);
  assert.ok(!existsSync(join(dest, 'stale.txt')));
  assert.ok(existsSync(join(dest, 'bin', 'shrine-inspect.mjs')));
  assert.deepEqual(readdirSync(join(home, '.local', 'share', 'shrine-inspect')), [PKG.version], 'no temp or backup folder left');
});

test('install refuses a changed tarball before extracting anything (exit 4)', { skip }, () => {
  const r = release();
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), 'si-inst-bad-'));
  const bad = join(dir, `shrine-inspect-${PKG.version}.tgz`);
  const bytes = readFileSync(r.tarball);
  bytes[bytes.length - 20] ^= 0xff;
  writeFileSync(bad, bytes);
  copyFileSync(r.install, join(dir, 'install.sh'));
  const out = sh(join(dir, 'install.sh'), [], { home });
  assert.equal(out.status, 4, out.stdout + out.stderr);
  assert.match(out.stderr, /checksum mismatch .* Nothing was installed\./);
  assert.ok(!existsSync(join(home, '.local', 'share', 'shrine-inspect')), 'nothing created');
  assert.ok(!existsSync(join(home, '.local', 'bin')), 'nothing linked');
});

test('install refuses Node older than 20 (exit 3) and a missing node', { skip }, () => {
  const r = release();
  const home = freshHome();
  const bin = mkdtempSync(join(tmpdir(), 'si-inst-node-'));
  writeFileSync(join(bin, 'node'), '#!/bin/sh\ncase "$1" in\n  -p) echo 18 ;;\n  --version) echo v18.20.0 ;;\nesac\n');
  chmodSync(join(bin, 'node'), 0o755);
  const old = sh(r.install, [], { home, path: `${bin}:/usr/bin:/bin` });
  assert.equal(old.status, 3, old.stdout + old.stderr);
  assert.match(old.stderr, /Node 20 or newer is needed; found v18\.20\.0/);
  const none = mkdtempSync(join(tmpdir(), 'si-inst-none-'));
  for (const t of ['dirname', 'sed', 'cut', 'tar', 'mkdir']) {
    const p = spawnSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
    if (p) writeFileSync(join(none, t), `#!/bin/sh\nexec ${p} "$@"\n`, { mode: 0o755 });
  }
  const missing = sh(r.install, [], { home, path: none });
  assert.equal(missing.status, 3, missing.stdout + missing.stderr);
  assert.match(missing.stderr, /node is not on PATH/);
  assert.ok(!existsSync(join(home, '.local')), 'nothing installed');
});

test('the source install.sh has nothing pinned and refuses to run (exit 2)', { skip }, () => {
  const out = sh(join(ROOT, 'scripts', 'install.sh'), [], { home: freshHome() });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /no pinned checksum/);
});

test('install --skill copies only the skill, and never overwrites a different copy', { skip }, () => {
  const r = release();
  const home = freshHome();
  const out = sh(r.install, ['--skill'], { home });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const target = join(home, '.claude', 'skills', 'shrine-inspect');
  assert.deepEqual(readdirSync(target), ['SKILL.md']);
  assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skill', 'skills', 'shrine-inspect', 'SKILL.md'), 'utf8'));
  assert.match(sh(r.install, ['--skill'], { home }).stdout, /Skill already installed/);
  // This skill from another release is replaced, so its version matches the CLI.
  writeFileSync(join(target, 'SKILL.md'), '---\nname: shrine-inspect\n---\nSkill version: 0.0.9\n');
  assert.match(sh(r.install, ['--skill'], { home }).stdout, /Skill updated/);
  assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), readFileSync(join(ROOT, 'skill', 'skills', 'shrine-inspect', 'SKILL.md'), 'utf8'));
  writeFileSync(join(target, 'SKILL.md'), 'mine\n');
  const again = sh(r.install, ['--skill'], { home });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Skill not copied: .* holds a different copy/);
  assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'mine\n');
});

test('a reinstall whose move fails keeps the previous install in place', { skip }, () => {
  const r = release();
  const home = freshHome();
  assert.equal(sh(r.install, [], { home }).status, 0);
  const dest = join(home, '.local', 'share', 'shrine-inspect', PKG.version);
  writeFileSync(join(dest, 'mine.txt'), 'old install');
  // An mv that fails only for the new copy's folder.
  const bin = mkdtempSync(join(tmpdir(), 'si-inst-mv-'));
  const realMv = spawnSync('sh', ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(bin, 'mv'), `#!/bin/sh\ncase "$1" in\n  */shrine-inspect-${PKG.version}) exit 1 ;;\nesac\nexec ${realMv} "$@"\n`, { mode: 0o755 });
  const out = sh(r.install, [], { home, path: `${bin}:${PATH}` });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /the previous install is kept/);
  assert.equal(readFileSync(join(dest, 'mine.txt'), 'utf8'), 'old install');
  assert.deepEqual(readdirSync(join(home, '.local', 'share', 'shrine-inspect')), [PKG.version], 'temp folders removed');
});
