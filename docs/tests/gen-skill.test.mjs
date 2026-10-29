// Tests for scripts/gen-skill.mjs. Run: npm test (Node built-in runner).
// The fixture in tests/fixtures/gen-skill holds a small page set and the skill it must produce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, PageError } from '../scripts/gen-skill.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../scripts/gen-skill.mjs');
const fixture = join(here, 'fixtures/gen-skill');
const expected = join(fixture, 'expected.md');

// A writable copy of the fixture, removed after the test.
function copyFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-skill-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const page = (dir, rel) => join(dir, 'src/content/docs', rel);
const hashOf = (text) => /^source-hash: ([0-9a-f]{64})$/m.exec(text)[1];

test('fixture pages render the expected skill', () => {
  assert.equal(generate(fixture), readFileSync(expected, 'utf8'));
});

test('two runs give the same bytes', (t) => {
  const dir = copyFixture(t);
  const a = join(dir, 'a.md');
  const b = join(dir, 'b.md');
  assert.equal(run('--docs', dir, '--out', a).status, 0);
  assert.equal(run('--docs', dir, '--out', b).status, 0);
  assert.deepEqual(readFileSync(a), readFileSync(b));
  assert.equal(generate(dir), generate(dir));
});

test('draft, index, and overview pages are excluded', () => {
  const text = generate(fixture);
  assert.doesNotMatch(text, /Draft Idea|Must not appear|Patterns Overview|Index page/);
});

test('North Star renders before the principles, links are absolute, bullets cap at 5', () => {
  const text = generate(fixture);
  assert.ok(text.indexOf('## North Star') < text.indexOf('## Principles'));
  assert.doesNotMatch(text, /\]\(\/SHRINE\//);
  assert.match(text, /- Five\n/);
  assert.doesNotMatch(text, /Six is past the cap/);
});

test('an edited page changes source-hash', (t) => {
  const dir = copyFixture(t);
  const before = hashOf(generate(dir));
  const file = page(dir, 'principles/alpha-rule.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('- One', '- One, edited'));
  assert.notEqual(hashOf(generate(dir)), before);
});

test('--check passes on a current file and fails on one changed bullet', (t) => {
  const dir = copyFixture(t);
  const out = join(dir, 'expected.md');
  assert.equal(run('--check', '--docs', dir, '--out', out).status, 0);
  const file = page(dir, 'patterns/beta-loop.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('- Output is checkable', '- Output is testable'));
  const result = run('--check', '--docs', dir, '--out', out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\+  - Output is testable/);
  assert.match(result.stderr, /is stale/);
});

test('a missing required section fails and names the file', (t) => {
  const dir = copyFixture(t);
  const file = page(dir, 'patterns/beta-loop.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## When Not to Use', '## Not Applicable'));
  assert.throws(() => generate(dir), (err) => err instanceof PageError
    && err.message.includes('src/content/docs/patterns/beta-loop.md')
    && err.message.includes('"## When Not to Use"'));
  const result = run('--docs', dir, '--out', join(dir, 'out.md'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gen-skill: src\/content\/docs\/patterns\/beta-loop\.md: required section/);
});

test('missing frontmatter fields and invalid YAML fail and name the file', (t) => {
  const dir = copyFixture(t);
  const file = page(dir, 'principles/alpha-rule.md');
  const raw = readFileSync(file, 'utf8');
  writeFileSync(file, raw.replace(/^description: .*\n/m, ''));
  assert.throws(() => generate(dir), /principles\/alpha-rule\.md: frontmatter "description" is missing/);
  writeFileSync(file, raw.replace('title: "Alpha Rule"', 'title: [unclosed'));
  assert.throws(() => generate(dir), /principles\/alpha-rule\.md: invalid frontmatter YAML/);
  writeFileSync(file, raw.replace(/^---\n/, ''));
  assert.throws(() => generate(dir), /principles\/alpha-rule\.md: no frontmatter block/);
});

test('an unclosed code fence fails and names the file', (t) => {
  const dir = copyFixture(t);
  const file = page(dir, 'principles/alpha-rule.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/```\n\n## Signal/, '\n## Signal'));
  assert.throws(() => generate(dir), /principles\/alpha-rule\.md: unclosed code fence/);
});
