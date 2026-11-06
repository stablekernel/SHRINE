// Read-only lint: write APIs only in src/io/runfolder.mjs; process spawns only in
// src/io/proc.mjs; node:fs only inside src/io/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintRoot, rel, report, walk } from './lib/walk.mjs';

const WRITE_APIS =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|mkdtempSync|mkdtemp|rmSync|rm|rmdirSync|rmdir|unlinkSync|unlink|renameSync|rename|copyFileSync|copyFile|cpSync|cp|truncateSync|truncate|ftruncate|chmodSync|chmod|chownSync|chown|symlinkSync|symlink|linkSync|utimesSync|utimes)\s*\(/;
const WRITE_FLAG = /\bopen(Sync)?\s*\([^)]*['"](w|a|r\+|w\+|a\+|wx|ax)['"]/;
const SPAWN = /\b(node:)?child_process\b/;
const FS_IMPORT = /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs/;

const WRITER = 'src/io/runfolder.mjs';
const SPAWNER = 'src/io/proc.mjs';

const root = lintRoot(process.argv);
const files = ['src', 'bin'].flatMap((d) => walk(join(root, d), (f) => f.endsWith('.mjs')));
const problems = [];
for (const file of files) {
  const r = rel(root, file);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.trim().startsWith('//')) return;
      const at = { file: r, line: i + 1 };
      const w = line.match(WRITE_APIS);
      if (r !== WRITER && w) problems.push({ ...at, message: `write API ${w[1]} outside ${WRITER}` });
      if (r !== WRITER && WRITE_FLAG.test(line)) problems.push({ ...at, message: 'write-mode open' });
      if (r !== SPAWNER && SPAWN.test(line)) problems.push({ ...at, message: `child_process outside ${SPAWNER}` });
      if (!r.startsWith('src/io/') && FS_IMPORT.test(line)) problems.push({ ...at, message: 'node:fs import outside src/io/' });
    });
}
report('lint-readonly', problems);
