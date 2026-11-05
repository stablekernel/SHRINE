// Builds a throwaway fixture home from test/fixtures/home/<name>: copies the
// hand-built .claude tree, turns project/ into a git repo, adds a one-line session
// stub (cwd only) so the project is in scope, and plants generated content
// (oversized and old files for "bad"). Never copies real user files.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';

export const FIXED_NOW = '2026-11-04T12:00:00.000Z';
const FIXTURES = fileURLToPath(new URL('../fixtures/home/', import.meta.url));
const OLD = new Date('2025-01-15T09:00:00Z');

// Fixture git ignores the host's global and system config (signing, hooks,
// templates) so every machine builds the same repo.
function git(cwd, args, date = new Date()) {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture Author',
      GIT_AUTHOR_EMAIL: 'author@fixture.example',
      GIT_COMMITTER_NAME: 'Fixture Author',
      GIT_COMMITTER_EMAIL: 'author@fixture.example',
      GIT_AUTHOR_DATE: date.toISOString(),
      GIT_COMMITTER_DATE: date.toISOString(),
    },
  });
}

export function makeHome(name, { projectName = `${name}-project`, sessionMtime = new Date() } = {}) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), `si-${name}-`)));
  const home = join(tmp, 'home');
  const claudeHome = join(home, '.claude');
  cpSync(join(FIXTURES, name, '.claude'), claudeHome, { recursive: true });

  const installed = join(claudeHome, 'plugins', 'installed_plugins.json');
  if (existsSync(installed)) {
    writeFileSync(installed, readFileSync(installed, 'utf8').replaceAll('${CLAUDE_HOME}', claudeHome));
  }

  const repo = join(tmp, 'work', projectName);
  cpSync(join(FIXTURES, name, 'project'), repo, { recursive: true });
  const bad = name === 'bad';
  const commitDate = bad ? OLD : new Date('2026-10-25T09:00:00Z');
  git(repo, ['init', '-q', '-b', 'main']);
  // No background auto-maintenance after the commit: a detached `git maintenance`
  // races the read-only tests that hash this tree.
  git(repo, ['config', 'maintenance.auto', 'false']);
  git(repo, ['config', 'gc.auto', '0']);
  git(repo, ['add', '-A'], commitDate);
  git(repo, ['commit', '-q', '-m', 'fixture'], commitDate);

  const projDir = join(claudeHome, 'projects', encodeProjectPath(repo));
  mkdirSync(projDir, { recursive: true });
  const stub = join(projDir, '00000000-0000-4000-8000-000000000001.jsonl');
  writeFileSync(stub, `${JSON.stringify({ type: 'user', cwd: repo, entrypoint: 'cli', sessionId: '00000000-0000-4000-8000-000000000001' })}\n`);
  utimesSync(stub, sessionMtime, sessionMtime);

  const memory = join(FIXTURES, name, 'project.MEMORY.md');
  if (existsSync(memory)) {
    mkdirSync(join(projDir, 'memory'), { recursive: true });
    cpSync(memory, join(projDir, 'memory', 'MEMORY.md'));
  }

  if (bad) {
    const rule = '- Always follow the legacy release checklist in full before any change.\n';
    writeFileSync(join(claudeHome, 'CLAUDE.md'), `# User instructions\n\n${rule.repeat(Math.ceil(45000 / rule.length))}`);
    for (const f of [join(claudeHome, 'CLAUDE.md'), join(repo, 'CLAUDE.md')]) utimesSync(f, OLD, OLD);
  }

  return {
    tmp,
    home,
    claudeHome,
    repo,
    projects: [{ root: repo, cwds: [repo] }],
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}
