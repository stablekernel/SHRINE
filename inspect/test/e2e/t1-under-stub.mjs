// Child process for network.test.mjs: a full T1 run (Gate A history, Gate B
// approved T1) with the fake judge, in process with the network stub preloaded.
// The fake judge is a child process of its own; only this process is stubbed,
// which is the CLI's own traffic. Prints the exit codes and the run folder.
import { Readable } from 'node:stream';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { fakeJudge } from './t1-helpers.mjs';

const io = (answer) => ({
  env: process.env,
  home: process.env.HOME,
  stdin: Object.assign(Readable.from([`${answer}\n`]), { isTTY: true }),
  stdout: { write: () => {} },
  stderr: process.stderr,
  judge: fakeJudge('auto'),
  seed: 7,
});
const first = await main(['run', '--tier', 'T1', '--json'], io('history'));
const runs = join(process.env.SHRINE_INSPECT_STATE_DIR, 'runs');
const runId = readdirSync(runs).sort().at(-1);
const second = await main(['approve', runId, 'B', 'T1', '--json'], io('yes'));
process.stdout.write(JSON.stringify({ first, second, dir: join(runs, runId) }));
