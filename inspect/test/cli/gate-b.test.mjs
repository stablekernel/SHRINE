// Gate B spends the user's tokens, so only a typed "yes" approves T1: "y" does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { askGateB } from '../../src/cli/approve.mjs';

const gate = { choices: ['T0', 'T1'], lines: [], offer: { tokens_low: 20000, tokens_high: 60000, episodes: 12, minutes: 5 } };
const io = (answer) => {
  const stdin = Readable.from([`${answer}\n`]);
  stdin.isTTY = true;
  return { stdin, stderr: new PassThrough() };
};

test('Gate B approves T1 only on a typed yes; "y" leaves the run paused', async () => {
  for (const choice of [undefined, 'T1']) {
    assert.equal((await askGateB(gate, choice, io('yes'))).choice, 'T1');
    for (const a of ['y', 'Y', 'ye', 'yes please']) {
      await assert.rejects(askGateB(gate, choice, io(a)), { code: 'E_NOT_ANSWERED' }, `${choice} ${a}`);
    }
  }
  assert.equal((await askGateB(gate, undefined, io('T0'))).choice, 'T0');
});
