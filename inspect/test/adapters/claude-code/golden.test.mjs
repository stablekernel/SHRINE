// Golden facts per Claude Code version bucket (plan T2.4, E3: no core-key drift
// across 21 versions, so two buckets plus a job log). Set UPDATE_GOLDEN=1
// to rewrite the goldens after a reviewed change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSession } from '../../../src/adapters/claude-code/events.mjs';
import { extractEpisodes } from '../../../src/episodes/extract.mjs';

const fx = (p) => fileURLToPath(new URL(`../../fixtures/sessions/${p}`, import.meta.url));
const golden = (v) => fileURLToPath(new URL(`../../golden/facts-v${v}.json`, import.meta.url));

async function factsOf(id, path, subagent_files = []) {
  const r = await readSession({ id, path, project: 'app', subagent_files });
  const episodes = extractEpisodes(r.session, r.timeline).map((e) => ({
    id: e.id,
    terminal: e.terminal,
    start: e.start,
    end: e.end,
    human_turns: e.human_turns,
    assistant_turns: e.assistant_turns,
    interrupts: e.interrupts,
    tokens: e.tokens,
    subagents: e.subagents,
    compactions: e.compactions,
    touched_files: e.touched_files,
    flags: e.flags,
  }));
  const files = r.files.map(({ kind, lines, parsed, skipped_by_sniff, corrupt, core_missing, unknown_types, version }) => ({ kind, lines, parsed, skipped_by_sniff, corrupt, core_missing, unknown_types, version }));
  return { session: r.session, episodes, files };
}

for (const [version, id, subs] of [
  ['2.1.286', 's-286', []],
  ['2.1.318', 's-318', ['v2.1.318/s-318/subagents/agent-a1.jsonl']],
]) {
  test(`golden facts for Claude Code ${version}`, async () => {
    const got = await factsOf(id, fx(`v${version}/${id}.jsonl`), subs.map(fx));
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(golden(version), `${JSON.stringify(got, null, 2)}\n`);
    assert.ok(existsSync(golden(version)), `missing golden ${golden(version)}`);
    assert.deepEqual(got, JSON.parse(readFileSync(golden(version), 'utf8')));
  });
}

test('2.1.318 bucket: raw request lines skipped unparsed, unknown type counted, corrupt line kept out', async () => {
  const { files } = await factsOf('s-318', fx('v2.1.318/s-318.jsonl'));
  assert.equal(files[0].skipped_by_sniff >= 2, true);
  assert.deepEqual(files[0].unknown_types, { 'future-type': 1 });
  assert.equal(files[0].corrupt, 1);
});

test('a version-less job log is not a session', async () => {
  const r = await readSession({ id: 'job', path: fx('job-log/job.jsonl'), project: 'app' });
  assert.equal(r.kind, 'job_log');
  assert.equal(r.session.turns, 0);
});
