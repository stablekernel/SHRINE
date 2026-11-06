// Child process for network.test.mjs: runs the real CLI in process with Gate A
// answered "history" on a fake TTY, so session streaming, the git linker, and
// the usage probes all run with the network stub preloaded. Test-only; no
// production hook is involved. Prints the exit code and the run's JSON line.
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.mjs';

const out = [];
const stdin = Object.assign(Readable.from(['history\n']), { isTTY: true });
const code = await main(['run', '--tier', 'T0', '--json'], {
  env: process.env,
  home: process.env.HOME,
  stdin,
  stdout: { write: (s) => out.push(String(s)) },
  stderr: process.stderr,
});
process.stdout.write(JSON.stringify({ code, out: out.join('') }));
