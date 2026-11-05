// Shared helpers for the T1 end-to-end tests: in-process CLI runs with the fake
// judge bound through io.judge (the bin never sets it), fixture homes with planted
// histories, and spy-log readers. No test here calls a model.
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../../src/cli/main.mjs';
import { parseJudgeOutput } from '../../src/adapters/claude-code/judge.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory } from '../synth/history.mjs';

export const FAKE_JUDGE = fileURLToPath(new URL('../fixtures/judge/fake-judge.mjs', import.meta.url));
export const NOW = Date.parse(FIXED_NOW);
export const DAY = 86400000;
export const SEED = 4242;

const sink = () => {
  const c = [];
  return { write: (s) => c.push(String(s)), text: () => c.join('') };
};
export const tty = (answer) => Object.assign(Readable.from([`${answer}\n`]), { isTTY: true });
export const silentTty = () => Object.assign(Readable.from([]), { isTTY: true });
export const piped = (answer = 'yes') => Object.assign(Readable.from([`${answer}\n`]), { isTTY: false });

export function fakeJudge(mode = 'auto') {
  return {
    available: { ok: true, bin: process.execPath },
    invocation: { cmd: process.execPath, args: [FAKE_JUDGE, mode], env: { PATH: process.env.PATH } },
    parse: parseJudgeOutput,
    disclosure: ['Fake judge for tests.'],
  };
}

export function stateDir() {
  return mkdtempSync(join(tmpdir(), 'si-t1-'));
}

export async function inproc(argv, h, state, { stdin = { isTTY: false }, judge = fakeJudge(), seed = SEED } = {}) {
  const stdout = sink();
  const stderr = sink();
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const code = await main(argv, { env, home: h.home, stdin, stdout, stderr, judge, seed });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

export const runDir = (state) => join(state, 'state', 'runs', readdirSync(join(state, 'state', 'runs')).sort().at(-1));
export const json = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
export const lines = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const judgeSpawns = (dir) => lines(dir, 'spy.jsonl').filter((e) => e.op === 'spawn' && e.judge);

// A fixture home with planted T1 histories. plants: [[preset, count, prefix]].
export function plantedHome(plants, name = 'good') {
  const h = makeHome(name, { sessionMtime: new Date(NOW - 25 * DAY) });
  for (const [preset, count, prefix] of plants) addHistory(h, preset, { nowMs: NOW, count, prefix });
  return h;
}

// Gate A history (inline TTY), pause at Gate B, then approve B with `answer`.
export async function runT1(h, { judge = fakeJudge(), answer = 'yes', choice = 'T1' } = {}) {
  const state = stateDir();
  const first = await inproc(['run', '--tier', 'T1', '--json'], h, state, { stdin: tty('history'), judge });
  const dir = runDir(state);
  const runId = dir.split('/').at(-1);
  const second = await inproc(['approve', runId, 'B', choice, '--json'], h, state, { stdin: tty(answer), judge });
  return { state, dir, runId, first, second };
}
