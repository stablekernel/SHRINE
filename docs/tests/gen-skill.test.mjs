// Tests for scripts/gen-skill.mjs. Run: npm test (Node built-in runner).
// The fixture in tests/fixtures/gen-skill holds a small page set and, under expected/, every
// file it must produce: the SKILL.md router and one references/<slug>.md per page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, PageError } from '../scripts/gen-skill.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../scripts/gen-skill.mjs');
const fixture = join(here, 'fixtures/gen-skill');
const expectedDir = join(fixture, 'expected');

// A writable copy of the fixture, removed after the test.
function copyFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-skill-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const page = (dir, rel) => join(dir, 'src/content/docs', rel);
const edit = (file, from, to) => writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
const hashOf = (files) => /^source-hash: ([0-9a-f]{64})$/m.exec(files.get('SKILL.md'))[1];
const readTree = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name).slice(dir.length + 1).split('\\').join('/'))
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), 'utf8')]);

test('fixture pages render the expected router and reference files', () => {
  assert.deepEqual([...generate(fixture)].sort(), readTree(expectedDir));
});

test('two runs give the same bytes', (t) => {
  const dir = copyFixture(t);
  const a = join(dir, 'a');
  const b = join(dir, 'b');
  assert.equal(run('--docs', dir, '--out', a).status, 0);
  assert.equal(run('--docs', dir, '--out', b).status, 0);
  assert.deepEqual(readTree(a), readTree(b));
  assert.deepEqual(generate(dir), generate(dir));
});

test('one reference per ratified page; draft, index, and overview are excluded', () => {
  const files = generate(fixture);
  assert.deepEqual([...files.keys()], ['SKILL.md', 'references/alpha-rule.md', 'references/beta-loop.md', 'references/tokens-to-value.md']);
  const all = [...files.values()].join('\n');
  assert.doesNotMatch(all, /Draft Idea|Must not appear|Index page|Patterns Overview/);
});

test('router routes symptoms and situations to reference files', () => {
  const router = generate(fixture).get('SKILL.md');
  assert.match(router, /\| Same mistake again \| \[Beta Loop\]\(references\/beta-loop\.md\), \[Alpha Rule\]\(references\/alpha-rule\.md\) \|/);
  assert.match(router, /\[Anti-patterns\]\(https:\/\/stablekernel\.github\.io\/SHRINE\/reference\/anti-patterns\/\)/);
  assert.match(router, /\| Generate, check, repair\. \| \[Beta Loop\]\(references\/beta-loop\.md\) \|/);
  assert.ok(router.indexOf('## North Star') < router.indexOf('## Principles'));
});

test('references keep anchors, absolute links, and the 5-bullet cap', () => {
  const files = generate(fixture);
  const alpha = files.get('references/alpha-rule.md');
  assert.match(alpha, /\(\[#signal-of-violation\]\(https:\/\/stablekernel\.github\.io\/SHRINE\/principles\/alpha-rule\/#signal-of-violation\)\)/);
  assert.match(alpha, /- Five\n/);
  assert.doesNotMatch(alpha, /Six is past the cap/);
  assert.doesNotMatch([...files.values()].join('\n'), /\]\(\/SHRINE\//);
});

test('an edited page changes source-hash', (t) => {
  const dir = copyFixture(t);
  const before = hashOf(generate(dir));
  edit(page(dir, 'principles/alpha-rule.md'), '- One', '- One, edited');
  assert.notEqual(hashOf(generate(dir)), before);
});

test('--check passes on current files and fails on one changed bullet', (t) => {
  const dir = copyFixture(t);
  const out = join(dir, 'expected');
  assert.equal(run('--check', '--docs', dir, '--out', out).status, 0);
  edit(page(dir, 'patterns/beta-loop.md'), '- Output is checkable', '- Output is testable');
  const result = run('--check', '--docs', dir, '--out', out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\+  - Output is testable/);
  assert.match(result.stderr, /stale: references\/beta-loop\.md/);
});

test('--check fails on an extra or missing reference file; a write removes the extra', (t) => {
  const dir = copyFixture(t);
  const out = join(dir, 'expected');
  writeFileSync(join(out, 'references/old-page.md'), 'left over\n');
  let result = run('--check', '--docs', dir, '--out', out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /extra: references\/old-page\.md/);
  assert.equal(run('--docs', dir, '--out', out).status, 0);
  assert.equal(existsSync(join(out, 'references/old-page.md')), false);
  rmSync(join(out, 'references/alpha-rule.md'));
  result = run('--check', '--docs', dir, '--out', out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: references\/alpha-rule\.md/);
});

test('a missing required section fails and names the file', (t) => {
  const dir = copyFixture(t);
  edit(page(dir, 'patterns/beta-loop.md'), '## When Not to Use', '## Not Applicable');
  assert.throws(() => generate(dir), (err) => err instanceof PageError
    && err.message.includes('src/content/docs/patterns/beta-loop.md')
    && err.message.includes('"## When Not to Use"'));
  const result = run('--docs', dir, '--out', join(dir, 'out'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gen-skill: src\/content\/docs\/patterns\/beta-loop\.md: required section/);
});

test('a missing symptom table fails and names the overview', (t) => {
  const dir = copyFixture(t);
  edit(page(dir, 'patterns/overview.md'), '## If You See X, Read Y', '## Symptoms');
  assert.throws(() => generate(dir), /patterns\/overview\.md: required section "## If You See X, Read Y"/);
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
  edit(page(dir, 'principles/alpha-rule.md'), /```\n\n## Signal/, '\n## Signal');
  assert.throws(() => generate(dir), /principles\/alpha-rule\.md: unclosed code fence/);
});
