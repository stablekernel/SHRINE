// Two in-scope repos with different instruction layouts: repo_layout runs and
// fails, and no Tier 0 finding kind covers it. The report must not count it as a
// clean check, call its area clear, or count its area as having no check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/main.mjs';
import { encodeProjectPath } from '../../src/adapters/claude-code/projects.mjs';
import { makeHome, FIXED_NOW } from '../synth/home.mjs';

function addDriftedRepo(h) {
  const repo = join(h.tmp, 'work', 'other');
  mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'agents', 'x.md'), '---\nname: x\n---\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' };
  for (const a of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'i']]) execFileSync('git', a, { cwd: repo, env });
  const projDir = join(h.claudeHome, 'projects', encodeProjectPath(repo));
  mkdirSync(projDir, { recursive: true });
  const sid = '00000000-0000-4000-8000-000000000002';
  writeFileSync(join(projDir, `${sid}.jsonl`), `${JSON.stringify({ type: 'user', cwd: repo, entrypoint: 'cli', sessionId: sid })}\n`);
}

test('repo layout drift with no finding kind: not counted clean, area not checked and clear, surfaced honestly', async () => {
  const h = makeHome('good', { projectName: 'app' });
  addDriftedRepo(h);
  const state = mkdtempSync(join(tmpdir(), 'si-drift-'));
  const out = [];
  const err = [];
  const code = await main(['run', '--tier', 'T0', '--no-history', '--json'], {
    env: { ...process.env, SHRINE_INSPECT_STATE_DIR: join(state, 'state'), SHRINE_INSPECT_CACHE_DIR: join(state, 'cache'), SHRINE_INSPECT_NOW: FIXED_NOW, SHRINE_INSPECT_TEMP_PATTERNS: '["^/nowhere/"]' },
    home: h.home,
    stdin: { isTTY: false },
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
  });
  assert.equal(code, 0, err.join(''));
  const s = JSON.parse(out.join(''));
  const scan = JSON.parse(readFileSync(join(s.run_dir, 'scan.json'), 'utf8'));
  const findings = JSON.parse(readFileSync(join(s.run_dir, 'findings.json'), 'utf8'));
  const html = readFileSync(s.report, 'utf8');
  h.cleanup();

  const layout = scan.structure.find((x) => x.check === 'repo_layout');
  assert.equal(layout.applicable, true);
  assert.equal(layout.pass, false);
  assert.ok(!findings.findings.some((f) => f.entry_id === layout.entry_id), 'no finding covers repo_layout');

  const { checks, not_passed } = findings.headline.counts;
  assert.equal(not_passed, 1);
  assert.equal(checks, findings.checked_clear.length + findings.findings.length, 'checks counts only passed checks and findings');
  assert.ok(!findings.checked_clear.some((c) => c.entry_id === layout.entry_id));
  const area = findings.coverage.find((c) => c.key === 'consistency-as-leverage');
  assert.equal(area.checked, true, 'a check ran in the area, so it is not an unchecked gap');
  assert.equal(area.not_passed, 1, 'the area is marked not passed, never clear');

  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (findings.findings.length === 0) assert.match(text, new RegExp(`No findings against ${checks + 1} SHRINE checks; 1 did not pass\\.`));
  assert.doesNotMatch(text, /No setup issues found/);
  assert.match(text, /1 check ran and did not pass; no Tier 0 finding exists for it yet\./);
  const unchecked = findings.coverage.filter((c) => !c.checked).length;
  const quiet = findings.coverage.filter((c) => c.checked && c.working + c.amplify === 0 && !c.not_passed).length;
  assert.ok(unchecked > 0 && unchecked < findings.coverage.length, `unchecked ${unchecked}`);
  assert.match(text, new RegExp(`\\b${unchecked} areas? ha(s|ve) no Tier 0 check yet\\.`));
  if (quiet) assert.match(text, new RegExp(`\\b${quiet} (other checked areas? showed no findings|areas? checked)`));
  else assert.doesNotMatch(text, /showed no findings|No SHRINE area showed a finding/);
});
