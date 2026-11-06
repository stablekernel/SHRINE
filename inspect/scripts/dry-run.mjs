// Release dry run (plan T3.5), offline: build the release, install it from the
// tarball into a clean HOME holding only a synthetic Claude Code history, run a
// background T1 with a stand-in judge (no model call), answer the gates through
// a pseudo-terminal, then check that nothing outside inspect's own folders
// changed (hash check) and that the share-safe report leaks nothing planted.
// Prints a transcript and keeps it, with the run folder, in the work folder.
//
//   node scripts/dry-run.mjs [--dir <work>] [--require-node20]
//
// Node 20: this Node when it is 20; else a Node 20 from nvm, fnm, or volta;
// else this Node, reported as a gap (--require-node20 makes the gap fatal).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;

const major = (v) => Number.parseInt(String(v).replace(/^v/, ''), 10);
const versionOf = (node) => spawnSync(node, ['--version'], { encoding: 'utf8' }).stdout?.trim() ?? '';
const highest = (dirs) => dirs.filter((d) => /^v?20\.\d+\.\d+$/.test(basename(d))).sort((a, b) => basename(a).localeCompare(basename(b), 'en', { numeric: true })).at(-1);
const subdirs = (d) => (existsSync(d) ? readdirSync(d).map((n) => join(d, n)) : []);

// A Node 20 binary: { node, source } or { node: this one, gap }.
export function findNode20({ execPath = process.execPath, env = process.env, home = homedir() } = {}) {
  if (major(process.versions.node) === 20 && execPath === process.execPath) return { node: execPath, source: 'this node' };
  const candidates = [];
  const nvm = env.NVM_DIR || join(home, '.nvm');
  const v = highest(subdirs(join(nvm, 'versions', 'node')));
  if (v) candidates.push([join(v, 'bin', 'node'), 'nvm']);
  for (const fnm of [env.FNM_DIR, join(home, '.local', 'share', 'fnm'), join(home, 'Library', 'Application Support', 'fnm'), join(home, '.fnm')].filter(Boolean)) {
    const f = highest(subdirs(join(fnm, 'node-versions')));
    if (f) candidates.push([join(f, 'installation', 'bin', 'node'), 'fnm']);
  }
  const volta = highest(subdirs(join(env.VOLTA_HOME || join(home, '.volta'), 'tools', 'image', 'node')));
  if (volta) candidates.push([join(volta, 'bin', 'node'), 'volta']);
  for (const [node, source] of candidates) if (existsSync(node) && major(versionOf(node)) === 20) return { node, source };
  return { node: execPath, source: 'this node', gap: `no Node 20 found (nvm, fnm, volta); ran on ${versionOf(execPath) || process.version}` };
}

// sha256 over every file and link under root (path, kind, mode, content), minus
// skipped absolute paths. Returns { files, digest, entries } (entries: one line per path).
export function hashTree(root, skip = []) {
  const h = createHash('sha256');
  const entries = new Map();
  const add = (rel, line) => {
    entries.set(rel, line);
    h.update(line);
  };
  let files = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (skip.some((s) => p === s || p.startsWith(s + sep))) continue;
      const st = lstatSync(p);
      const rel = relative(root, p);
      if (st.isSymbolicLink()) add(rel, `L ${rel} ${readlinkSync(p)}\n`);
      else if (st.isDirectory()) {
        // A folder that only leads to a skipped one (Library/ above the state dir)
        // may be created by inspect; its other contents are still compared.
        if (!skip.some((k) => k.startsWith(p + sep))) add(rel, `D ${rel} ${st.mode.toString(8)}\n`);
        walk(p);
      } else {
        files++;
        add(rel, `F ${rel} ${st.mode.toString(8)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}\n`);
      }
    }
  };
  walk(root);
  return { files, digest: h.digest('hex'), entries };
}

// Paths added, removed, or changed between two hashTree results.
export function treeDiff(a, b) {
  const out = [];
  for (const [k, v] of a.entries) if (!b.entries.has(k)) out.push(`removed ${k}`);
  else if (b.entries.get(k) !== v) out.push(`changed ${k}`);
  for (const k of b.entries.keys()) if (!a.entries.has(k)) out.push(`added ${k}`);
  return out;
}

// Needles found in an HTML report. user: matched as a whole word only.
export function leaks(text, { secrets = [], paths = [], names = [], prompts = [], user = null }) {
  const found = [];
  for (const [kind, list] of [['secret', secrets], ['path', paths], ['name', names], ['prompt', prompts]]) {
    for (const n of list) if (n && text.includes(n)) found.push(`${kind}: ${kind === 'secret' ? `${n.slice(0, 4)}...` : n}`);
  }
  // The user name as a whole word, outside the page's own CSS and script (a user
  // named root would match the stylesheet's :root).
  const body = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, '');
  if (user && new RegExp(`(?<![\\w-])${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(body)) found.push('user name');
  const abs = text.match(/\/(Users|home|private|var\/folders|tmp)\/[\w.-]+\//);
  if (abs) found.push(`absolute path: ${abs[0]}`);
  return found;
}

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// Runs argv with a pseudo-terminal on stdin (BSD or util-linux `script`) and
// types `input` after a pause, keeping stdin open a moment so the answer is read
// before end of input reaches the terminal.
export function withTty(argv, { env, input }) {
  const cmd = argv.map(q).join(' ');
  const tty = process.platform === 'darwin' ? `script -q /dev/null ${cmd}` : `script -qec ${q(cmd)} /dev/null`;
  const r = spawnSync('/bin/sh', ['-c', `(sleep 1; printf '%s\\n' ${q(input)}; sleep 2) | ${tty}`], { env, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r/g, '').replace(/\x04|\^D/g, '') };
}

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--dir');
  const work = realpathSync(at >= 0 ? (mkdirSync(resolve(argv[at + 1]), { recursive: true }), resolve(argv[at + 1])) : mkdtempSync(join(tmpdir(), 'shrine-dry-run-')));
  const lines = [];
  // Paths print relative to the work folder, so the transcript stays readable.
  const say = (s = '') => {
    const line = String(s).replaceAll(work, '$WORK');
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };
  const failures = [];
  const check = (ok, what) => {
    say(`${ok ? 'PASS' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
  };
  const show = (cmd, r, keep = 12) => {
    say(`$ ${cmd}`);
    const text = (r.out ?? `${r.stdout ?? ''}${r.stderr ?? ''}`).trim().split('\n').filter(Boolean);
    for (const l of text.slice(0, keep)) say(`  ${l}`);
    if (text.length > keep) say(`  ... ${text.length - keep} more lines`);
    say(`  (exit ${r.status})`);
    return r;
  };
  const finish = () => {
    writeFileSync(join(work, 'transcript.txt'), `${lines.join('\n')}\n`);
    say(`Transcript: ${join(work, 'transcript.txt')}`);
    say(failures.length ? `DRY RUN FAILED: ${failures.join('; ')}` : 'DRY RUN PASSED');
    process.exit(failures.length ? 1 : 0);
  };

  say(`SHRINE Inspect ${VERSION} release dry run, ${new Date().toISOString()}, ${process.platform} ${process.arch}`);
  lines.push(`Work folder: ${work}`);
  process.stdout.write(`Work folder ($WORK): ${work}\n`);

  // 1. Node 20.
  const n = findNode20();
  say(`Node: ${n.node} (${versionOf(n.node)}, ${n.source})`);
  if (n.gap) {
    say(`GAP: ${n.gap}`);
    if (argv.includes('--require-node20')) failures.push('Node 20 not available');
  }
  const nodeDir = dirname(n.node);
  const sysPath = `${nodeDir}${delimiter}/usr/bin${delimiter}/bin`;

  // 2. Build the release offline.
  const dist = join(work, 'dist');
  const build = show(`node scripts/release.mjs --out ${dist}`, spawnSync(n.node, [join(PKG_ROOT, 'scripts', 'release.mjs'), '--out', dist], { cwd: PKG_ROOT, encoding: 'utf8' }));
  check(build.status === 0, 'release build');
  if (build.status !== 0) return finish();
  show('sha256 -c SHA256SUMS', spawnSync('sh', ['-c', 'if command -v sha256sum >/dev/null; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi'], { cwd: dist, encoding: 'utf8' }));

  // 3. Clean HOME with a synthetic history (built from the test generators).
  const fx = spawnSync(n.node, [join(PKG_ROOT, 'scripts', 'dry-run-fixture.mjs')], { encoding: 'utf8', env: { PATH: sysPath, TMPDIR: work, HOME: work } });
  if (fx.status !== 0) {
    say(fx.stderr);
    check(false, 'synthetic history fixture');
    return finish();
  }
  const f = JSON.parse(fx.stdout);
  const home = f.home;
  say(`Clean HOME: ${home} (only a synthetic .claude, ${readdirSync(join(home, '.claude', 'projects')).length} project folder, repo at ${f.repo})`);

  // 4. Install from the tarball with the pinned install.sh.
  const inst = show(`HOME=${home} sh ${join(dist, 'install.sh')} --skill`, spawnSync('/bin/sh', [join(dist, 'install.sh'), '--skill'], { encoding: 'utf8', env: { HOME: home, PATH: sysPath } }));
  check(inst.status === 0, 'install from the release tarball (checksum verified before extract)');
  if (inst.status !== 0) return finish();

  // Inspect's own folders: install, link, state, cache, and the copied skill.
  const own = [join(home, '.local', 'share', 'shrine-inspect'), join(home, '.local', 'bin'), join(home, '.local', 'state', 'shrine-inspect'), join(home, '.cache', 'shrine-inspect'), join(home, 'Library', 'Application Support', 'shrine-inspect'), join(home, 'Library', 'Caches', 'shrine-inspect'), join(home, '.claude', 'skills', 'shrine-inspect')];
  const before = { home: hashTree(home, own), repo: hashTree(f.repo) };

  // 5. Stand-in judge: a `claude` command on PATH that runs the test fake judge.
  const fakebin = join(work, 'fakebin');
  mkdirSync(fakebin, { recursive: true });
  copyFileSync(join(PKG_ROOT, 'test', 'fixtures', 'judge', 'fake-judge.mjs'), join(fakebin, 'fake-judge.mjs'));
  writeFileSync(join(fakebin, 'claude'), `#!/bin/sh\n# Stand-in judge for the dry run: no model call.\nexec ${q(n.node)} ${q(join(fakebin, 'fake-judge.mjs'))} auto\n`);
  chmodSync(join(fakebin, 'claude'), 0o755);
  say(`Judge: stand-in ${join(fakebin, 'claude')} (test fake judge, no model call)`);

  const bin = join(home, '.local', 'bin', 'shrine-inspect');
  // The fixture sits in a temp folder, which inspect skips as scratch by default,
  // and its history is dated around a fixed day.
  const env = { HOME: home, PATH: [fakebin, join(home, '.local', 'bin'), sysPath].join(delimiter), SHRINE_INSPECT_NOW: f.now, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]', TERM: 'dumb' };
  say(`Env: HOME=${home} SHRINE_INSPECT_NOW=${f.now} SHRINE_INSPECT_TEMP_PATTERNS=["^/nowhere/"] PATH=<stand-in judge>:~/.local/bin:<node 20>:/usr/bin:/bin`);
  const cli = (args) => spawnSync(bin, args, { env, encoding: 'utf8', timeout: 120_000 });
  const status = (id) => {
    const r = cli(['status', id, '--json']);
    try {
      return JSON.parse(r.stdout);
    } catch {
      return { state: 'error', raw: r.stdout + r.stderr };
    }
  };
  const until = (id, pred, ms) => {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) {
      s = status(id);
      if (pred(s)) return s;
      spawnSync('sleep', ['0.5']);
    }
    return s;
  };

  // 6. Background T1, gates typed through a pseudo-terminal.
  const t0 = Date.now();
  const start = show('shrine-inspect start --tier T1 --json', cli(['start', '--tier', 'T1', '--json']));
  check(start.status === 0, 'start detaches a background run');
  if (start.status !== 0) return finish();
  const id = JSON.parse(start.stdout).run_id;
  let s = until(id, (x) => x.state === 'gate' || x.state === 'died', 60_000);
  show(`shrine-inspect status ${id}`, cli(['status', id]));
  check(s.state === 'gate' && s.gate === 'A', 'background run pauses at Gate A');
  show(`[tty] shrine-inspect approve ${id} A history --background  (typed: yes)`, withTty([bin, 'approve', id, 'A', 'history', '--background'], { env, input: 'yes' }), 20);
  s = until(id, (x) => x.state === 'gate' && x.gate === 'B' || x.state === 'died' || x.state === 'done', 120_000);
  check(s.state === 'gate' && s.gate === 'B', 'scan finishes in the background; pauses at Gate B');
  show(`[tty] shrine-inspect approve ${id} B T1 --background  (typed: yes)`, withTty([bin, 'approve', id, 'B', 'T1', '--background'], { env, input: 'yes' }), 40);
  s = until(id, (x) => x.state === 'done' || x.state === 'died' || x.state === 'gate', 300_000);
  show(`shrine-inspect status ${id}`, cli(['status', id]));
  check(s.state === 'done', `run done in ${Math.round((Date.now() - t0) / 1000)} s`);
  if (s.state !== 'done') return finish();
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const verify = JSON.parse(readFileSync(join(s.run_dir, 'verify.json'), 'utf8'));
  say(`T1: tier ${findings.tier?.ran ?? findings.tier}, judged ${findings.judging?.judged} of ${findings.judging?.planned} episodes, ${findings.judging?.tokens_used} tokens (stand-in judge), ${findings.findings.length} findings`);
  check(findings.judging?.judged === 12, 'T1 judged 12 episodes');
  say(`Report: ${s.report}`);
  say(`Share-safe report: ${s.share_safe}`);

  // 7. Read-only hash check: HOME (minus inspect's own folders) and the repo.
  const after = { home: hashTree(home, own), repo: hashTree(f.repo) };
  say(`Read-only check: HOME ${before.home.files} files sha256 ${before.home.digest.slice(0, 16)} -> ${after.home.digest.slice(0, 16)}; repo ${before.repo.files} files ${before.repo.digest.slice(0, 16)} -> ${after.repo.digest.slice(0, 16)}; runtime verify ok=${verify.ok}`);
  for (const d of [...treeDiff(before.home, after.home), ...treeDiff(before.repo, after.repo)].slice(0, 20)) say(`  ${d}`);
  check(before.home.digest === after.home.digest && before.repo.digest === after.repo.digest && verify.ok === true, 'read-only: nothing outside inspect folders changed');

  // 8. Share-safe leak check.
  const safe = readFileSync(s.share_safe, 'utf8');
  const nd = f.needles;
  const found = leaks(safe, nd);
  say(`Leak check (share-safe): ${nd.secrets.length} secret tokens, ${nd.paths.length} paths, ${nd.names.length} names, ${nd.prompts.length} prompts, OS user, absolute paths; found ${found.length}${found.length ? `: ${found.join(', ')}` : ''}`);
  check(found.length === 0, 'share-safe report leaks nothing planted');
  const local = readFileSync(s.report, 'utf8');
  check(nd.names.some((x) => local.includes(x)) || nd.prompts.some((x) => local.includes(x)), 'control: the local report does name planted items, so the leak check can fail');
  return finish();
}

if (process.argv[1] && basename(process.argv[1]) === 'dry-run.mjs') main();
