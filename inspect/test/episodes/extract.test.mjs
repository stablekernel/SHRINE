import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractEpisodes, commitKind, endsWithQuestion } from '../../src/episodes/extract.mjs';
import { commandSegments, matchesAtCommand } from '../../src/probes/command-position.mjs';
import { isTestCommand } from '../../src/probes/usage.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const labelled = load('../fixtures/segmentation/labelled.json');
const COMMIT = load('../../src/probes/patterns/commit.json');
const at = (min) => new Date(Date.parse('2026-11-01T10:00:00Z') + min * 60000).toISOString();

// Rows to a normalized timeline, the shape events.mjs produces.
export function timelineOf(rows) {
  const tl = [];
  let n = 0;
  for (const [min, kind, detail] of rows) {
    const t = at(min);
    if (kind === 'human') tl.push({ t, kind: 'human', text: detail ?? 'do the thing', uuid: `u${min}` });
    else if (kind === 'text') tl.push({ t, kind: 'assistant_text', text: detail });
    else if (kind === 'bash') tl.push({ t, kind: 'tool_use', id: `t${++n}`, name: 'Bash', command: detail, key: `k${n}` });
    else if (kind === 'ok' || kind === 'err') tl.push({ t, kind: 'tool_result', id: `t${n}`, error: kind === 'err' });
    else if (kind === 'command') tl.push({ t, kind: 'command', name: detail });
  }
  return tl;
}

test('labelled segmentation set: boundary agreement at or over 80%', () => {
  assert.ok(labelled.cases.length > 0);
  let agree = 0;
  for (const c of labelled.cases) {
    const got = extractEpisodes({ id: 's', project: 'p' }, timelineOf(c.rows)).map((e) => e.terminal);
    if (JSON.stringify(got) === JSON.stringify(c.expect)) agree++;
    else console.log(`disagree: ${c.name}: got ${got.join(',')}, want ${c.expect.join(',')}`);
  }
  const rate = agree / labelled.cases.length;
  assert.ok(rate >= 0.8, `agreement ${agree} of ${labelled.cases.length}`);
});

test('every labelled case agrees (synthetic set; regressions show here first)', () => {
  assert.ok(labelled.cases.length > 0);
  for (const c of labelled.cases) {
    assert.deepEqual(extractEpisodes({ id: 's', project: 'p' }, timelineOf(c.rows)).map((e) => e.terminal), c.expect, c.name);
  }
});

test('commit pattern list: positives match, negatives do not', () => {
  assert.ok(COMMIT.positive.length > 0 && COMMIT.negative.length > 0);
  for (const p of COMMIT.positive) assert.ok(commitKind(p), p);
  for (const n of COMMIT.negative) assert.equal(commitKind(n), null, n);
});

test('command segments strip heredocs, quotes, and wrappers', () => {
  assert.deepEqual(commandSegments('cd app && FOO=1 uv run pytest -q | tail -5'), ['cd app', 'pytest -q', 'tail -5']);
  assert.deepEqual(commandSegments('python -m pytest; env -i X=1 npm test'), ['pytest', 'npm test']);
  assert.ok(!matchesAtCommand('grep -r "npm test" .', ['npm test']));
  assert.ok(matchesAtCommand('for f in a; do npm test; done', ['npm test']));
});

test('heredocs end at their closing line; one with no closing line is kept as text', () => {
  assert.deepEqual(commandSegments("git commit -m \"$(cat <<'EOF'\nnpm test\nEOF\n)\" && npm run lint"), ["git commit -m ''", 'npm run lint']);
  assert.deepEqual(commandSegments('cat <<-EOF > a\n\tnpm test\n\tEOF\nls'), ['cat', 'ls']);
  assert.deepEqual(commandSegments('cat <<A\nx\nA\ncat <<A\ny\nA\nls'), ['cat', 'cat', 'ls']);
  assert.deepEqual(commandSegments('cat <<EOF\nnpm test\nEOFX\nnpm run lint'), ['cat <<EOF', 'npm test', 'EOFX', 'npm run lint']);
  assert.deepEqual(commandSegments('cat <<EOF > f\nbody\n'), ['cat <<EOF > f', 'body']);
  assert.deepEqual(commandSegments('a <<\nnpm test'), ['a <<', 'npm test']);
});

test('here-strings and arithmetic shifts are not heredocs', () => {
  assert.deepEqual(commandSegments('git log <<<x\nnpm test'), ['git log <<<x', 'npm test']);
  assert.deepEqual(commandSegments('jq . <<< "$x"\ngit commit -m fix\nx'), ["jq . <<< ''", 'git commit -m fix', 'x']);
  assert.deepEqual(commandSegments('echo $((1<<2))\nnpm test\n2'), ['echo $((1<<2))', 'npm test', '2']);
  assert.deepEqual(commandSegments('((a <<= 1))\nnpm test\n1'), ['a <<= 1))', 'npm test', '1']);
  assert.deepEqual(commandSegments('echo $(( (a<<b) ))\nnpm test\nb'), ['echo $(( (a<<b) ))', 'npm test', 'b']);
  assert.deepEqual(commandSegments('x=$((1<<2)); cat <<EOF\nnpm test\nEOF\nls'), ['x=$((1<<2))', 'cat', 'ls']);
  assert.ok(isTestCommand('echo $((1<<2))\nnpm test'));
  assert.equal(commitKind('x=$((a<<1))\ngit commit -m wip'), 'commit');
});

test('open quotes run to the end', () => {
  assert.deepEqual(commandSegments('echo "a \\" && npm test'), ["echo ''"]);
  assert.deepEqual(commandSegments("echo 'npm test; ls"), ["echo ''"]);
  assert.deepEqual(commandSegments('a <<\nnpm test'), ['a <<', 'npm test']);
});

test('question detection allows trailing markup', () => {
  assert.ok(endsWithQuestion('Should I continue?'));
  assert.ok(endsWithQuestion('**Proceed?**'));
  assert.ok(endsWithQuestion('Ready? )** \n'));
  assert.ok(!endsWithQuestion('Is it? x'));
  assert.ok(!endsWithQuestion(''));
  assert.ok(!endsWithQuestion(null));
  assert.ok(!endsWithQuestion('Done. Questions? None.'));
});

test('episode fields: counts, tokens, files, subagents, interrupts, humans after interrupt', () => {
  const tl = [
    { t: at(0), kind: 'human', text: 'add a parser', uuid: 'root' },
    { t: at(1), kind: 'usage', tokens: 100 },
    { t: at(1), kind: 'tool_use', id: 'a', name: 'Edit', key: 'k1', files: ['/w/p.js'] },
    { t: at(2), kind: 'tool_use', id: 'b', name: 'Task', key: 'k2' },
    { t: at(2), kind: 'usage', tokens: 50, sub: true },
    { t: at(2), kind: 'tool_use', id: 'c', name: 'Write', key: 'k3', files: ['/w/q.js'], sub: true },
    { t: at(3), kind: 'interrupt' },
    { t: at(3), kind: 'human', text: 'no, use the other file', uuid: 'h2' },
    { t: at(4), kind: 'compact' },
    { t: at(5), kind: 'usage', tokens: 10 },
  ];
  const [e] = extractEpisodes({ id: 's1', project: 'p' }, tl);
  assert.equal(e.root_turn_id, 'root');
  assert.equal(e.human_turns, 2);
  assert.equal(e.assistant_turns, 2);
  assert.equal(e.tokens, 160);
  assert.equal(e.subagents, 1);
  assert.equal(e.interrupts, 1);
  assert.equal(e.compactions, 1);
  assert.deepEqual(e.touched_files, ['/w/p.js', '/w/q.js']);
  assert.equal(e.flags.corrections, 1, 'the turn after an interrupt is a correction candidate');
  assert.equal(e.correction_t, at(3));
  assert.equal(e.calls, undefined, 'per-call lists are dropped after flags are computed');
  assert.equal(e.start, at(0));
  assert.equal(e.end, at(5));
});

test('the episode timeline sorts by full time across midnight and labels UTC', async () => {
  const { episodeTimeline } = await import('../../src/cli/scan.mjs');
  const ep = { start: '2026-11-01T23:50:00.000Z', end: '2026-11-02T00:10:00.000Z', terminal: 'commit', correction_t: null, last_text_t: null };
  const tl = episodeTimeline(ep, { done_claim: false, tested: false });
  assert.deepEqual(tl.map((e) => `${e.t} ${e.label_scrubbed}`), ['23:50 UTC Prompt', '00:10 UTC Commit']);
});

test('a successful commit keeps the shas its result printed as commit_refs', () => {
  const tl = timelineOf([[0, 'human'], [1, 'bash', 'git commit -m x'], [2, 'ok']]);
  tl[2].shas = ['1a2b3c4'];
  const [e] = extractEpisodes({ id: 's', project: 'p' }, tl);
  assert.deepEqual(e.commit_refs, ['1a2b3c4']);
  const failed = timelineOf([[0, 'human'], [1, 'bash', 'git commit -m x'], [2, 'err']]);
  failed[2].shas = ['1a2b3c4'];
  assert.deepEqual(extractEpisodes({ id: 's', project: 'p' }, failed)[0].commit_refs, []);
});
