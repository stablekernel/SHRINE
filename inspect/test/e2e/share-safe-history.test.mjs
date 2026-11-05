// Share-safe copy with history read: folder and file names with &, parentheses,
// apostrophes, commas, and non-ASCII letters in session cwds, touched files, and
// skipped session files never reach report.share-safe.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';
import { addHistory, addSession } from '../synth/history.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
// Distinctive parts of each name; none may appear in the share-safe copy.
// Folder words reach the local report (skipped files, setup paths); file words reach facts.
const FOLDER_WORDS = ['Smithers', 'Sonsby', 'Acmeco', 'Brienne', 'richsee'];
const FILE_WORDS = ['denscheidt', 'ngstrom', 'Pruefung'];

test('share-safe report with history masks odd folder and file names', async () => {
  const h = makeHome('bad', { repoUnderHome: "Smithers & Sonsby (Acmeco), O'Brienne/Zürichsee", projectName: 'shop', sessionMtime: new Date(NOW - 25 * DAY) });
  addHistory(h, 'planted', { nowMs: NOW });
  addSession(h, {
    id: 'abcd0000-0000-4000-8000-000000000001',
    startMs: NOW - 3 * DAY,
    script: [['human', 'Tidy the notes.'], ['edit', "Müller-Lüdenscheidt (QA), Pruefung/Ångstrom & Co's notes (v2), final.js"], ['text', 'All done.']],
  });
  // A session file with core keys missing in the odd cwd's folder: listed in skipped files.
  const bad = join(h.claudeHome, 'projects', encodeProjectPath(h.repo), "Smithers & Sonsby (Acmeco), O'Brienne.jsonl");
  writeFileSync(bad, '{"type":"user","sessionId":"x"}\n');
  // Older than the real sessions, so the folder's cwd still comes from a parsable file.
  utimesSync(bad, new Date(NOW - 22 * DAY), new Date(NOW - 22 * DAY));

  const state = mkdtempSync(join(tmpdir(), 'si-safe-'));
  const out = [];
  const err = [];
  const env = { ...process.env, HOME: h.home, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' };
  const stdin = Object.assign(Readable.from(['history\n']), { isTTY: true });
  const code = await main(['run', '--tier', 'T0', '--json'], { env, home: h.home, stdin, stdout: { write: (s) => out.push(String(s)) }, stderr: { write: (s) => err.push(String(s)) } });
  h.cleanup();
  assert.equal(code, 0, err.join(''));
  const s = JSON.parse(out.join(''));
  const facts = JSON.parse(readFileSync(join(s.run_dir, 'facts.json'), 'utf8'));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const local = readFileSync(s.report, 'utf8');
  const safe = readFileSync(join(s.run_dir, 'report.share-safe.html'), 'utf8');

  // The odd names did reach the run: history was read and the local copies name them.
  assert.ok(facts.episodes.length > 0, 'episodes were extracted');
  assert.ok(facts.episodes.some((e) => e.touched_files.some((f) => f.includes('ngstrom'))), 'touched file recorded');
  assert.ok((findings.skipped_files ?? []).some((f) => f.path_scrubbed.includes('Brienne.jsonl')), 'the odd skipped session file is listed');
  for (const w of FOLDER_WORDS) assert.ok(local.includes(w), `local report names ${w}`);
  for (const w of [...FOLDER_WORDS, ...FILE_WORDS]) {
    const i = safe.indexOf(w);
    assert.equal(i, -1, `${w} leaked: ${safe.slice(Math.max(0, i - 80), i + 40)}`);
  }
});
