// Privacy and write-scope claims in the user docs match what the tool does: a T1
// judge launch is a Claude Code launch, which may write its own state files, and
// only the share-safe copy is masked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISCLOSURE } from '../../src/adapters/claude-code/judge.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const TRIAL = read('../../TRIAL.md');
const GUIDE = read('../../../docs/src/content/docs/guide/inspect.mdx');

test('write-scope claims name the T1 judge launch exception', () => {
  for (const [name, doc] of [['TRIAL.md', TRIAL], ['inspect.mdx', GUIDE]]) {
    assert.match(doc, /judge call launches Claude Code, which may update its own state and cache files \(`~\/\.claude\.json`, files under `~\/\.claude\/`\)/, name);
  }
  assert.match(GUIDE, /with `--skill`, the skill to `~\/\.claude\/skills\/shrine-inspect\/`/);
  assert.ok(DISCLOSURE.some((l) => l.includes('~/.claude.json, files under ~/.claude/')));
});

test('masking claims say which file is masked', () => {
  assert.doesNotMatch(GUIDE, /reaches a judge or a file/);
  assert.match(GUIDE, /`report\.html` is for you; it is not masked/);
});

const README = read('../../README.md');
const PKG = JSON.parse(read('../../package.json'));

test('install steps: PATH export, installer usage, Gate A, --no-history, check-share', () => {
  for (const [name, doc] of [['TRIAL.md', TRIAL], ['inspect.mdx', GUIDE]]) {
    assert.ok(doc.includes('export PATH="$HOME/.local/bin:$PATH"'), name);
    assert.ok(doc.includes('sh install.sh [--skill] [path/to/tgz]'), name);
    assert.match(doc, /tarball next to `install\.sh`|next to `install\.sh`, not in your current folder/, name);
    assert.ok(doc.includes('shrine-inspect run --tier T0 --no-history'), name);
    assert.ok(doc.includes('shrine-inspect check-share'), name);
    assert.ok(doc.includes(`inspect-v${PKG.version}`), `${name} names the current release`);
  }
  assert.ok(TRIAL.includes('Type one of no-history, history:'), 'TRIAL quotes the Gate A prompt');
});

test('user docs carry no machine-specific measured tokens or times', () => {
  const MEASURED = /\b\d+(\.\d+)?K tokens|\b\d+(\.\d+)?K to \d+(\.\d+)?K|\b54K|\b65K|41 s(econds)?\b|4\.0 min|38 seconds|2\.2 minutes|measured on (one|two) (real )?runs?|measured runs/;
  for (const [name, doc] of [['TRIAL.md', TRIAL], ['inspect.mdx', GUIDE], ['README.md', README]]) {
    assert.doesNotMatch(doc, MEASURED, name);
  }
});
