// Gates A and C confirm a named choice only on a typed "yes", as Gate B does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { askGate, GATE_A, GATE_C } from '../../src/cli/approve.mjs';

const io = (answer) => {
  const stdin = Readable.from([`${answer}\n`]);
  stdin.isTTY = true;
  return { stdin, stderr: new PassThrough() };
};

for (const [name, gate] of [['A', GATE_A], ['C', GATE_C]]) {
  test(`Gate ${name} confirms a choice only on a typed yes; "y" leaves the run paused`, async () => {
    const g = { ...gate, gate: name };
    for (const choice of g.choices) {
      assert.equal((await askGate(g, choice, io('yes'))).choice, choice);
      for (const a of ['y', 'Y', 'ye', 'yes please', '']) {
        await assert.rejects(askGate(g, choice, io(a)), { code: 'E_NOT_ANSWERED' }, `${choice} ${a}`);
      }
    }
    assert.equal((await askGate(g, null, io(g.choices[0]))).choice, g.choices[0]);
  });
}
