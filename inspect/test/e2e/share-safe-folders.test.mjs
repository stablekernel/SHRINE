// Share-safe copies mask folder names that hold spaces, punctuation, and
// non-ASCII letters: client folders are often named "Acme & Sons (Legal)".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

const PLANTED = ['Acme', 'Sons', 'Legal', 'Bob', 'Café', 'Nordström', 'Ünïcode', 'Örg', 'Kunden'];

test('share-safe report masks folder names with punctuation and non-ASCII letters', async () => {
  const h = makeHome('bad', { repoUnderHome: "Bob's Kunden/Acme & Sons (Legal)/Café Nordström, Inc", projectName: 'Ünïcode Örg' });
  const state = mkdtempSync(join(tmpdir(), 'si-folders-'));
  const out = [];
  const err = [];
  const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
    env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    home: h.home,
    cwd: h.repo,
    stdin: { isTTY: false },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  h.cleanup();
  try {
    assert.equal(code, 0, err.join(''));
    const s = JSON.parse(out.join(''));
    const local = readFileSync(s.report, 'utf8');
    const safe = readFileSync(join(s.run_dir, 'report.share-safe.html'), 'utf8');
    // The local report names the folders, so the share-safe check is not vacuous.
    assert.ok(PLANTED.some((w) => local.includes(w)), 'local report names a planted folder');
    // Includes the JSON embedded in the page, not only the visible text.
    assert.ok(safe.includes('<script'), 'share-safe page embeds its data');
    for (const w of PLANTED) {
      const i = safe.indexOf(w);
      assert.equal(i, -1, `${w} leaked: ${safe.slice(Math.max(0, i - 80), i + 40)}`);
    }
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
