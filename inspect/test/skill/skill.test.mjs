// The harness skill is a thin driver (plan T3.2, T3.4): it names only CLI
// commands that exist, carries the package version, never answers a gate, and
// the wrapper holds only the skill and a manifest, no code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../../src/cli/main.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WRAPPER = join(ROOT, 'skill');
const SKILL = readFileSync(join(WRAPPER, 'skills', 'shrine-inspect', 'SKILL.md'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(WRAPPER, '.claude-plugin', 'plugin.json'), 'utf8'));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [relative(WRAPPER, join(dir, d.name)).split(sep).join('/')]));
const frontmatter = (text) => Object.fromEntries(text.split('\n---')[0].split('\n').slice(1).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
// Text the agent runs: fenced blocks and inline code spans.
const runnable = () => [...SKILL.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).concat([...SKILL.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));

test('skill names only CLI commands that exist', () => {
  const named = [...SKILL.matchAll(/shrine-inspect (\w+)/g)].map((m) => m[1]);
  assert.ok(named.length >= 3);
  for (const c of named) assert.ok(COMMANDS.includes(c), `unknown command: shrine-inspect ${c}`);
  const allowed = frontmatter(SKILL)['allowed-tools'];
  for (const m of allowed.matchAll(/shrine-inspect (\w+)/g)) assert.ok(COMMANDS.includes(m[1]), m[1]);
});

test('skill version, every --skill-version, and the manifest equal package.json', () => {
  assert.match(SKILL, new RegExp(`^Skill version: ${PKG.version.replaceAll('.', '\\.')}$`, 'm'));
  const passed = [...SKILL.matchAll(/--skill-version (\S+)/g)].map((m) => m[1]);
  assert.ok(passed.length >= 3, 'every CLI call carries the handshake');
  for (const v of passed) assert.equal(v, PKG.version);
  assert.equal(MANIFEST.version, PKG.version);
  assert.equal(MANIFEST.license, PKG.license);
  assert.equal(MANIFEST.name, frontmatter(SKILL).name);
});

test('skill never answers a gate: no approve, resume, or typed answer in anything it runs or may run', () => {
  const run = runnable().join('\n');
  assert.doesNotMatch(run, /\b(approve|resume|purge)\b/);
  assert.doesNotMatch(run, /--(grant|worker|background)\b/);
  assert.doesNotMatch(run, /\b(yes|printf|echo)\b|\|/);
  const allowed = frontmatter(SKILL)['allowed-tools'];
  assert.doesNotMatch(allowed, /approve|resume|purge|Bash\(\*|Bash\)/);
  assert.match(SKILL, /Never answer a gate/);
  assert.match(SKILL, /own terminal/);
});

test('skill checks Node 20, starts in the background, polls status, and prints the report path', () => {
  assert.match(SKILL, /node --version/);
  assert.match(SKILL, /Node 20 or newer/);
  assert.match(SKILL, /shrine-inspect start --tier T0 --session-id/);
  assert.match(SKILL, /empty or still shows as a placeholder, leave out `--session-id` and its value/);
  assert.match(SKILL, /shrine-inspect status <run_id>/);
  assert.match(SKILL, /`report` and `share_safe` paths/);
});

test('wrapper holds only the skill and a manifest: no code', () => {
  assert.deepEqual(files(WRAPPER).sort(), ['.claude-plugin/plugin.json', 'skills/shrine-inspect/SKILL.md']);
  assert.doesNotMatch(SKILL, /\bsrc\//);
});
