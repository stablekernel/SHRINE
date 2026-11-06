import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory } from '../synth/history.mjs';

const BIN = fileURLToPath(new URL('../../bin/shrine-inspect.mjs', import.meta.url));
const STUB = fileURLToPath(new URL('./no-network.cjs', import.meta.url));
const CHILD = fileURLToPath(new URL('./history-under-stub.mjs', import.meta.url));
const DAY = 86400000;

function stubbedEnv(h) {
  const state = mkdtempSync(join(tmpdir(), 'si-net-'));
  const log = join(state, 'blocked.log');
  return {
    log,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require "${STUB}"`,
      SHRINE_TEST_NET_LOG: log,
      HOME: h.home,
      SHRINE_INSPECT_STATE_DIR: join(state, 'state'),
      SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'),
      SHRINE_INSPECT_NOW: FIXED_NOW,
      SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]',
    },
  };
}
const blocked = (log) => (existsSync(log) ? readFileSync(log, 'utf8').trim() : '');

test('the stub records and throws on every network path it covers', () => {
  const h = makeHome('good');
  const { env, log } = stubbedEnv(h);
  const probe = `
    const tries = [() => require('node:net').connect(1), () => require('node:dns').resolve4('x', () => {}),
      () => require('node:dns').promises.resolveTxt('x'), () => new (require('node:dns').Resolver)().resolve('x', () => {}),
      () => require('node:https').get('https://x'), () => fetch('https://x')];
    let thrown = 0;
    for (const t of tries) { try { t(); } catch { thrown++; } }
    process.stdout.write(String(thrown));`;
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', env });
  assert.equal(r.stdout, '6', r.stderr);
  assert.equal(blocked(log).split('\n').length, 6);
  h.cleanup();
});

test('a full T0 run with --no-history completes with no network call', () => {
  const h = makeHome('bad');
  const { env, log } = stubbedEnv(h);
  const r = spawnSync(process.execPath, [BIN, 'run', '--tier', 'T0', '--no-history', '--json'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).report.endsWith('report.html'));
  assert.equal(blocked(log), '');
  h.cleanup();
});

test('a T0 run that reads history (streaming, git linker, usage probes) makes no network call', () => {
  const h = makeHome('bad', { sessionMtime: new Date(Date.parse(FIXED_NOW) - 25 * DAY) });
  addHistory(h, 'planted', { nowMs: Date.parse(FIXED_NOW) });
  addHistory(h, 'clean', { nowMs: Date.parse(FIXED_NOW), prefix: 'cccc' });
  const { env, log } = stubbedEnv(h);
  const r = spawnSync(process.execPath, [CHILD], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const { code, out } = JSON.parse(r.stdout);
  assert.equal(code, 0, r.stderr);
  const dir = JSON.parse(out).run_dir;
  const findings = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'));
  assert.equal(findings.history.read, true);
  assert.ok(findings.usage.counts.sessions >= 12);
  const spy = readFileSync(join(dir, 'spy.jsonl'), 'utf8');
  assert.ok(spy.includes('"stream"'), 'session logs were streamed');
  assert.ok(/"cmd":"git"[^\n]*"log"/.test(spy), 'the linker ran git');
  assert.equal(blocked(log), '');
  h.cleanup();
});
