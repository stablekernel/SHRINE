// `purge`: deletes this tool's state and cache folders, nothing else.
import { purge } from '../io/runfolder.mjs';
import { EXIT } from './errors.mjs';

export function purgeCommand(io, { context }) {
  const { dirs } = context(io);
  const r = purge([dirs.state, dirs.cache]);
  if (io.json) io.stdout.write(`${JSON.stringify(r)}\n`);
  else {
    for (const d of r.removed) io.stdout.write(`removed ${d}\n`);
    for (const d of r.skipped) io.stdout.write(`skipped ${d} (not created by shrine-inspect)\n`);
    if (!r.removed.length && !r.skipped.length) io.stdout.write('nothing to purge\n');
  }
  return { code: EXIT.OK };
}
