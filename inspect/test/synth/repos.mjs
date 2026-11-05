// Generated git repos for linker tests: commits at fixed dates, reverts, fixups,
// and amends. Test-only; uses execFileSync directly.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function makeRepo() {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), 'si-repo-'))), 'repo');
  mkdirSync(root);
  const git = (args, date) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture Author',
        GIT_AUTHOR_EMAIL: 'author@fixture.example',
        GIT_COMMITTER_NAME: 'Fixture Author',
        GIT_COMMITTER_EMAIL: 'author@fixture.example',
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    }).trim();
  git(['init', '-q', '-b', 'main']);
  const api = {
    root,
    git,
    commit(date, subject, files = { 'a.txt': subject }) {
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, f)), { recursive: true });
        writeFileSync(join(root, f), `${text}\n`);
      }
      git(['add', '-A']);
      git(['commit', '-q', '-m', subject], date);
      return git(['rev-parse', 'HEAD']);
    },
    revert(date, sha) {
      git(['revert', '--no-edit', sha], date);
      return git(['rev-parse', 'HEAD']);
    },
    amend(date, text) {
      writeFileSync(join(root, 'a.txt'), `${text}\n`);
      git(['add', '-A']);
      git(['commit', '-q', '--amend', '--no-edit'], date);
      return git(['rev-parse', 'HEAD']);
    },
    cleanup: () => rmSync(dirname(root), { recursive: true, force: true }),
  };
  return api;
}
