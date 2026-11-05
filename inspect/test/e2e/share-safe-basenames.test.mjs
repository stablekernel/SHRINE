// Share-safe copies mask file basenames that are not the tool's own file names:
// memory notes, commands, and @imports often name clients. The local report keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const CLIENTS = ['initechpayroll', 'globex', 'hooli'];

test('share-safe report masks client-named basenames; local report keeps them', async () => {
  const h = makeHome('good', { projectName: 'app' });
  const old = new Date(Date.parse(FIXED_NOW) - 400 * 86400000);
  const mem = join(h.claudeHome, 'projects', encodeProjectPath(h.repo), 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '- [x](initechpayroll-contract-terms.md)\n');
  writeFileSync(join(mem, 'initechpayroll-contract-terms.md'), 'terms\n');
  utimesSync(join(mem, 'initechpayroll-contract-terms.md'), old, old);
  mkdirSync(join(h.claudeHome, 'commands'), { recursive: true });
  writeFileSync(join(h.claudeHome, 'commands', 'globex-release.md'), 'run release\n');
  utimesSync(join(h.claudeHome, 'commands', 'globex-release.md'), old, old);
  writeFileSync(join(h.repo, 'CLAUDE.md'), `${readFileSync(join(h.repo, 'CLAUDE.md'), 'utf8')}\n@docs/hooli-onboarding.md\n`);
  mkdirSync(join(h.repo, 'docs'), { recursive: true });
  writeFileSync(join(h.repo, 'docs', 'hooli-onboarding.md'), 'x\n');

  const state = mkdtempSync(join(tmpdir(), 'si-names-'));
  const out = [];
  const err = [];
  const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
    env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    home: h.home,
    stdin: { isTTY: false },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  h.cleanup();
  assert.equal(code, 0, err.join(''));
  const s = JSON.parse(out.join(''));
  const local = readFileSync(s.report, 'utf8');
  const safe = readFileSync(join(s.run_dir, 'report.share-safe.html'), 'utf8');

  // The local report still names the files: the stale probe found them.
  for (const w of ['initechpayroll']) assert.ok(local.includes(w), `local report keeps ${w}`);
  for (const w of CLIENTS) {
    const i = safe.indexOf(w);
    assert.equal(i, -1, `${w} leaked: ${safe.slice(Math.max(0, i - 60), i + 40)}`);
  }
  // The extension survives, so the share-safe copy stays readable.
  assert.match(safe, /&lt;file&gt;\.md/);
});
