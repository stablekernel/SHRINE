#!/usr/bin/env node
// shrine-inspect: parses argv, dispatches, maps exit codes.
// Exit codes: 0 ok, 1 internal, 2 usage, 3 gate waiting, 4 unsupported format, 5 integrity failure.
import { homedir } from 'node:os';
import { main } from '../src/cli/main.mjs';

const code = await main(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exitCode = code;
