import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import * as fsread from '../../src/io/fsread.mjs';
import { createRunFolder, purge } from '../../src/io/runfolder.mjs';
import { git, gitInvocation } from '../../src/io/git.mjs';
import { checkSpawn, OWN_BIN } from '../../src/io/proc.mjs';
import { appDirs } from '../../src/io/paths.mjs';
import { prompt } from '../../src/io/tty.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'si-io-'));

beforeEach(() => fsread.resetSpy());

test('fsread opens only in read mode', () => {
  const dir = tmp();
  const f = join(dir, 'a.txt');
  writeFileSync(f, 'x');
  for (const mode of ['w', 'a', 'r+', 'w+']) {
    assert.throws(() => fsread.open(f, mode), { code: 'E_WRITE_MODE' });
  }
  const fd = fsread.open(f);
  assert.equal(typeof fd, 'number');
  fsread.close(fd);
});

test('every open appends path, mode, and time to the spy log', () => {
  const dir = tmp();
  const f = join(dir, 'a.txt');
  writeFileSync(f, 'one\ntwo\nthree\n');
  fsread.readText(f);
  fsread.readLines(f, 2);
  const opens = fsread.spyLog().filter((e) => e.op === 'open');
  assert.equal(opens.length, 2);
  for (const e of opens) {
    assert.equal(e.path, f);
    assert.equal(e.mode, 'r');
    assert.equal(typeof e.t, 'number');
  }
});

test('readLines stops at the line limit', () => {
  const dir = tmp();
  const f = join(dir, 'a.txt');
  writeFileSync(f, Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'));
  assert.deepEqual(fsread.readLines(f, 3), ['line 0', 'line 1', 'line 2']);
});

test('git rejects write-capable and non-allowlisted subcommands', () => {
  for (const sub of ['commit', 'push', 'checkout', 'reset', 'fetch', 'gc', 'config', '-C']) {
    assert.throws(() => git([sub], { cwd: tmpdir() }), { code: 'E_GIT_DENIED' }, sub);
  }
  assert.throws(() => git(['status'], { cwd: tmpdir() }), { code: 'E_GIT_DENIED' });
  assert.throws(() => git(['diff', '--output=x'], { cwd: tmpdir() }), { code: 'E_GIT_DENIED' });
});

test('git runs with optional locks off', () => {
  const inv = gitInvocation(['rev-parse', 'HEAD'], tmpdir());
  assert.equal(inv.cmd, 'git');
  assert.equal(inv.env.GIT_OPTIONAL_LOCKS, '0');
});

test('diffing git commands never run external diff or textconv programs', () => {
  process.env.GIT_EXTERNAL_DIFF = '/bin/false';
  try {
    for (const sub of ['diff', 'show', 'log']) {
      const inv = gitInvocation([sub, 'HEAD'], tmpdir());
      assert.deepEqual(inv.args.slice(5, 8), [sub, '--no-ext-diff', '--no-textconv'], sub);
      assert.ok(inv.args.join(' ').includes('-c log.showSignature=false'), sub);
      assert.equal(inv.env.GIT_EXTERNAL_DIFF, undefined);
    }
    assert.deepEqual(gitInvocation(['rev-parse', 'HEAD'], tmpdir()).args.slice(5), ['rev-parse', 'HEAD']);
  } finally {
    delete process.env.GIT_EXTERNAL_DIFF;
  }
});

test('git spawns are recorded in the spy log', () => {
  git(['rev-parse', '--is-inside-work-tree'], { cwd: tmpdir() });
  const spawns = fsread.spyLog().filter((e) => e.op === 'spawn');
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].cmd, 'git');
});

test('spawn allowlist is git plus a self-spawn of this package bin', () => {
  assert.doesNotThrow(() => checkSpawn('git', ['log']));
  assert.doesNotThrow(() => checkSpawn(process.execPath, [OWN_BIN, 'run']));
  assert.throws(() => checkSpawn(process.execPath, ['-e', '1']), { code: 'E_SPAWN_DENIED' });
  assert.throws(() => checkSpawn('sh', ['-c', 'ls']), { code: 'E_SPAWN_DENIED' });
  assert.throws(() => checkSpawn('claude', ['--print']), { code: 'E_SPAWN_DENIED' });
});

test('runfolder writes inside the run folder and refuses paths outside it', () => {
  const state = tmp();
  const run = createRunFolder(state, 'r1');
  run.writeJson('facts.json', { a: 1 });
  run.markDone('facts');
  assert.ok(run.isDone('facts'));
  assert.deepEqual(JSON.parse(readFileSync(join(run.dir, 'facts.json'), 'utf8')), { a: 1 });
  assert.throws(() => run.write('../escape.txt', 'x'), { code: 'E_OUTSIDE_RUN_FOLDER' });
  assert.throws(() => run.write('/etc/passwd', 'x'), { code: 'E_OUTSIDE_RUN_FOLDER' });
  const writes = fsread.spyLog().filter((e) => e.op === 'write');
  assert.ok(writes.length > 0 && writes.every((e) => e.path.startsWith(state)));
});

test('purge removes only folders this tool created', () => {
  const state = tmp();
  createRunFolder(state, 'r1');
  const other = tmp();
  writeFileSync(join(other, 'keep.txt'), 'x');
  const result = purge([state, other]);
  assert.equal(existsSync(state), false);
  assert.equal(existsSync(join(other, 'keep.txt')), true);
  assert.deepEqual(result.skipped, [other]);
});

test('a state dir that already held other files is never marked, so purge skips it', () => {
  const state = tmp();
  writeFileSync(join(state, 'mine.txt'), 'x');
  createRunFolder(state, 'r1');
  const result = purge([state]);
  assert.equal(existsSync(join(state, 'mine.txt')), true);
  assert.deepEqual(result.skipped, [state]);
});

test('paths follow macOS conventions', () => {
  const d = appDirs({ platform: 'darwin', env: {}, home: '/Users/u' });
  assert.equal(d.state, '/Users/u/Library/Application Support/shrine-inspect');
  assert.equal(d.cache, '/Users/u/Library/Caches/shrine-inspect');
});

test('paths follow XDG on Linux with defaults', () => {
  assert.deepEqual(appDirs({ platform: 'linux', env: {}, home: '/home/u' }), {
    state: '/home/u/.local/state/shrine-inspect',
    cache: '/home/u/.cache/shrine-inspect',
  });
  assert.deepEqual(appDirs({ platform: 'linux', env: { XDG_STATE_HOME: '/s', XDG_CACHE_HOME: '/c' }, home: '/home/u' }), {
    state: '/s/shrine-inspect',
    cache: '/c/shrine-inspect',
  });
});

test('tty.prompt refuses when stdin is not a TTY', async () => {
  const input = Readable.from(['yes\n']);
  await assert.rejects(prompt('Continue?', { input }), { code: 'E_NOT_TTY' });
});
