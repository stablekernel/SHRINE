import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUDGE_ENV, judgeAvailable, judgeInvocation, parseJudgeOutput, TESTED_VERSION } from '../../../src/adapters/claude-code/judge.mjs';
import { CLASSIFIER_SCHEMA } from '../../../src/judge/validate.mjs';
import { armJudge, checkSpawn, disarmJudge, runJudge } from '../../../src/io/proc.mjs';

const FAKE = fileURLToPath(new URL('../../fixtures/judge/fake-judge.mjs', import.meta.url));

test('invocation: one headless --print call, no session saved, no tools, no MCP, no settings files, schema enforced', () => {
  const inv = judgeInvocation({ bin: '/bin/claude', schema: CLASSIFIER_SCHEMA, env: { HOME: '/h', PATH: '/bin' } });
  const a = inv.args;
  assert.equal(inv.cmd, '/bin/claude');
  assert.equal(a[0], '--print');
  for (const f of ['--no-session-persistence', '--restricted', '--strict-mcp-config', '--disable-slash-commands']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--tools') + 1], '', 'every tool removed');
  assert.equal(a[a.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.deepEqual(JSON.parse(a[a.indexOf('--json-schema') + 1]), CLASSIFIER_SCHEMA);
  assert.equal(a[a.indexOf('--output-format') + 1], 'json');
  // Nothing of the session reaches argv: the bundle goes on stdin.
  assert.ok(!a.some((x) => /episode|turns/.test(x) && !x.startsWith('{"type"')));
  for (const [k, v] of Object.entries(JUDGE_ENV)) assert.equal(inv.env[k], v);
  assert.equal(inv.env.HOME, '/h', 'the user login is kept');
  assert.ok(!Object.keys(inv.env).some((k) => /API_KEY|AUTH_TOKEN/.test(k) && !(k in { HOME: 1, PATH: 1 })), 'no key handling added');
});

test('availability: found on PATH by file metadata; an older harness falls back to T0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'si-bin-'));
  assert.equal(judgeAvailable({ env: { PATH: dir } }).ok, false);
  writeFileSync(join(dir, 'claude'), '#!/bin/sh\n');
  chmodSync(join(dir, 'claude'), 0o755);
  const ok = judgeAvailable({ env: { PATH: dir }, version: TESTED_VERSION });
  assert.equal(ok.ok, true);
  assert.equal(ok.bin, join(dir, 'claude'));
  assert.match(judgeAvailable({ env: { PATH: dir }, version: '2.0.1' }).reason, /older than/);
});

test('parse: structured output, or result text as JSON; tokens summed per kind; dollars never read', () => {
  const o = { episode_id: 'e', nonce: 'n', outcome: 'unknown', corrections: [] };
  const a = parseJudgeOutput(JSON.stringify({ type: 'result', structured_output: o, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }, modelUsage: { 'm-1': {} }, total_cost_usd: 9 }));
  assert.deepEqual(a.output, o);
  assert.deepEqual(a.tokens, { in: 10, out: 5, cache_read: 3, cache_write: 2 });
  assert.equal(a.model_id, 'm-1');
  assert.ok(!JSON.stringify(a).includes('9'.repeat(1)) || !('cost' in a));
  const b = parseJudgeOutput(JSON.stringify({ type: 'result', result: `\`\`\`json\n${JSON.stringify(o)}\n\`\`\`` }));
  assert.deepEqual(b.output, o);
  assert.equal(parseJudgeOutput(JSON.stringify({ type: 'result', result: 'I think it was fine.' })).output, null, 'free text is never output');
});

test('spawn: the judge command is denied before Gate B, and arming needs a T1 yes typed in a terminal', () => {
  const inv = { cmd: process.execPath, args: [FAKE, 'auto'] };
  disarmJudge();
  assert.throws(() => checkSpawn(inv.cmd, inv.args), { code: 'E_SPAWN_DENIED' });
  const dir = mkdtempSync(join(tmpdir(), 'si-arm-'));
  const facts = join(dir, 'facts.json');
  for (const B of [null, { choice: 'T0', by: 'tty' }, { choice: 'T1', by: 'flag' }]) {
    writeFileSync(facts, JSON.stringify({ consent: { B } }));
    assert.throws(() => armJudge(facts, inv), { code: 'E_SPAWN_DENIED' });
    assert.throws(() => checkSpawn(inv.cmd, inv.args), { code: 'E_SPAWN_DENIED' });
  }
  assert.throws(() => armJudge(join(dir, 'missing.json'), inv), { code: 'E_SPAWN_DENIED' });
  writeFileSync(facts, JSON.stringify({ consent: { B: { choice: 'T1', by: 'tty' } } }));
  armJudge(facts, inv);
  checkSpawn(inv.cmd, inv.args);
  assert.throws(() => checkSpawn(inv.cmd, ['-e', 'x']), { code: 'E_SPAWN_DENIED' }, 'only the armed script, not any node');
  assert.throws(() => checkSpawn('/bin/sh', ['-c', 'x']), { code: 'E_SPAWN_DENIED' });
  disarmJudge();
  assert.throws(() => checkSpawn(inv.cmd, inv.args), { code: 'E_SPAWN_DENIED' });
});

test('runJudge: stub round trip on stdin and stdout; stdout capped; time limit kills', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'si-arm-'));
  const facts = join(dir, 'facts.json');
  writeFileSync(facts, JSON.stringify({ consent: { B: { choice: 'T1', by: 'tty' } } }));
  const inv = { cmd: process.execPath, args: [FAKE, 'auto'] };
  armJudge(facts, inv);
  try {
    const r = await runJudge({ ...inv, cwd: dir, input: 'SHRINE inspect judge v1: x\n<data-ab>\n{"episode_id":"e","turns":[],"config":[]}\n</data-ab>\n' });
    assert.equal(r.status, 0);
    assert.equal(parseJudgeOutput(r.stdout).output.episode_id, 'e');
    const capped = await runJudge({ ...inv, cwd: dir, input: 'x', maxStdout: 10 });
    assert.equal(capped.truncated, true);
    assert.ok(capped.stdout.length <= 10);
    armJudge(facts, { cmd: process.execPath, args: ['-e'] });
    const slow = await runJudge({ cmd: process.execPath, args: ['-e', 'setTimeout(() => {}, 10000)'], cwd: dir, input: '', timeoutMs: 200 });
    assert.equal(slow.timedOut, true);
  } finally {
    disarmJudge();
  }
});
