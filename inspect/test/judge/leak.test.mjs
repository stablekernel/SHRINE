// Leak tests for T1 (plan T1 tasks 2 and 8a): planted secrets, fixture home
// paths, git author names, and the OS user name in session text must not survive
// into the work order (what the judge sees), judgments.jsonl, report.html, or
// the share-safe file. Any survivor fails CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { addSession } from '../synth/history.mjs';
import { plantedCorpus } from '../synth/secrets.mjs';
import { DAY, NOW, plantedHome, runT1 } from '../e2e/t1-helpers.mjs';
import { userMentions } from '../../scripts/lib/leak.mjs';

const body = plantedCorpus(11).split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('private-key'));
const STOP = new Set(['Authorization', 'authorization', 'DefaultEndpointsProtocol', 'EndpointSuffix']);
const needles = [...new Set(body.join('\n').match(/[A-Za-z0-9]{12,}/g))].filter((n) => !STOP.has(n));
const sid = (i) => `dddd0000-0000-4000-8000-${String(i).padStart(12, '0')}`;

test('T1 leak: zero secret survivors, zero absolute paths, zero OS user or author names in every T1 output', async () => {
  const h = plantedHome([]);
  const user = userInfo().username;
  // Whole word only (a CI user "runner" is part of "judge_runner"); as root in a
  // container, the report's own :root selector and shipped script are not the user.
  const userIn = (text) => userMentions(text, user);
  for (let i = 0; i < 12; i++) {
    const secrets = body.slice((i * 4) % body.length, ((i * 4) % body.length) + 4).join(' and ');
    const script = [
      ['instructions', [{ path: `${h.repo}/CLAUDE.md`, content: `# Rules\n- Keep keys out: ${body[i % body.length]}\n- Owner ${user}, home ${h.home}\n` }]],
      ['human', `Wire the config at ${h.home}/work/secret-project/app.env for ${user}: ${secrets}`],
      ['edit', 'src/a.js'],
      ['text', `Reading ${h.repo}/src/a.js with ${body[(i + 1) % body.length]}`],
      ['human', `Actually, never print ${body[(i + 2) % body.length]} and do not touch ${h.repo}/.env, Fixture Author said so.`],
      ['text', 'Understood.'],
    ];
    addSession(h, { id: sid(i), startMs: NOW - (20 - i) * DAY, script });
  }
  const r = await runT1(h);
  assert.equal(r.second.code, 0, r.second.stderr);
  // The judged finding carries your own words (before/after, quotes) into report.html.
  const findings = JSON.parse(readFileSync(join(r.dir, 'findings.json'), 'utf8'));
  assert.ok(findings.findings.some((f) => f.kind === 'late_constraint' && f.pivot.source === 'user_prompt'), 'excerpts reach the report');
  const files = ['workorder.json', 'judgments.jsonl', 'report.html', 'report.share-safe.html', 'sample.json', 'facts.json', 'findings.json'];
  for (const f of files) {
    const p = join(r.dir, f);
    assert.ok(existsSync(p), `${f} written`);
    const text = readFileSync(p, 'utf8');
    const survivors = needles.filter((n) => text.includes(n));
    assert.deepEqual(survivors, [], `secret survivors in ${f}`);
    if (f === 'facts.json' || f === 'findings.json') continue; // scrubbed display paths (~/...) are kept there, as at T0
    assert.ok(!text.includes(h.home), `home path in ${f}`);
    assert.ok(!text.includes(h.tmp), `fixture path in ${f}`);
    assert.deepEqual(userIn(text), [], `OS user in ${f}`);
  }
  // What the judge saw: no OS user, no author name, no absolute path.
  const order = readFileSync(join(r.dir, 'workorder.json'), 'utf8');
  assert.deepEqual(userIn(order), [], 'OS user in the work order');
  assert.ok(!order.includes('Fixture Author'), 'git author in the work order');
  assert.doesNotMatch(order, /"\/(Users|home|private|var|tmp)\//);
  const safe = readFileSync(join(r.dir, 'report.share-safe.html'), 'utf8');
  assert.deepEqual(userIn(safe), [], 'OS user in the share-safe file');
  h.cleanup();
});
