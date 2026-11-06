// Synthetic Claude Code home for the release dry run: a git repo, a setup, and
// 18 sessions in the retention window (late constraints, restated rules, and 4
// sessions carrying planted secrets, names, and paths). Built from the test
// generators; nothing comes from a real home. The fixture lands under TMPDIR.
// Prints JSON: home, repo, and the needles the share-safe copy must not hold.
import { userInfo } from 'node:os';
import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { makeHome, FIXED_NOW } from '../test/synth/home.mjs';
import { addHistory, addSession } from '../test/synth/history.mjs';
import { plantedCorpus } from '../test/synth/secrets.mjs';

const NOW = Date.parse(FIXED_NOW);
const DAY = 86400000;
const h = makeHome('good', { projectName: 'acme-billing', sessionMtime: new Date(NOW - 25 * DAY) });
// The fixture's own stand-in skill of the same name goes, so the install copies the real one.
rmSync(join(h.claudeHome, 'skills', 'shrine-inspect'), { recursive: true, force: true });
addHistory(h, 'late', { nowMs: NOW, count: 8, prefix: 'aaaa' });
addHistory(h, 'ignored', { nowMs: NOW, count: 6, prefix: 'bbbb', first: 8, offsetMs: 3_600_000 });

// Secrets are generated at run time (no secret-shaped literal in the repo).
// The planted histories' own prompts: share-safe drops session excerpts.
const PLANTED_PROMPTS = ['Actually, use semicolons as the separator and keep the header row.', "Don't edit generated files in the generated client folder, regenerate them instead."];
const secrets = plantedCorpus(23).split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('private-key'));
const user = userInfo().username;
const prompts = [];
for (let i = 0; i < 4; i++) {
  const first = `Wire the config at ${h.home}/work/acme-billing/app.env for ${user}: ${secrets[i]}`;
  const second = `Actually, never print ${secrets[(i + 1) % secrets.length]} and do not touch ${h.repo}/.env, Fixture Author said so.`;
  prompts.push(first, second);
  addSession(h, {
    id: `cccc0000-0000-4000-8000-${String(14 + i).padStart(12, '0')}`,
    startMs: NOW - (6 - i) * DAY + 7_200_000,
    script: [
      ['instructions', [{ path: `${h.repo}/CLAUDE.md`, content: `# Rules\n- Keep keys out: ${secrets[(i + 2) % secrets.length]}\n- Owner ${user}, home ${h.home}\n` }]],
      ['human', first],
      ['edit', 'src/config.js'],
      ['text', `Reading ${h.repo}/src/config.js`],
      ['human', second],
      ['text', 'Understood.'],
    ],
  });
}

const STOP = new Set(['Authorization', 'authorization', 'DefaultEndpointsProtocol', 'EndpointSuffix']);
const secretNeedles = [...new Set(secrets.join('\n').match(/[A-Za-z0-9]{12,}/g))].filter((n) => !STOP.has(n));
process.stdout.write(
  `${JSON.stringify({
    home: h.home,
    repo: h.repo,
    tmp: h.tmp,
    now: FIXED_NOW,
    needles: {
      secrets: secretNeedles,
      paths: [h.tmp, h.home, h.repo],
      names: [basename(h.repo), 'Fixture Author', 'author@fixture.example'],
      user,
      prompts: [...prompts, ...PLANTED_PROMPTS],
    },
  })}\n`,
);
