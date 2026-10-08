// Tests for src/tools/shrine-check.mjs (inspect mode). Run: npm test (Node built-in runner, no dependencies).
// Each test builds a fixture: a git project with instruction and config files, a temporary folder
// outside it with the fetched pages, a manifest, the checker copy, and a plan file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKER = fileURLToPath(new URL('../src/tools/shrine-check.mjs', import.meta.url));
const CHECKER_SRC = readFileSync(CHECKER, 'utf8');
const PROMPT = readFileSync(new URL('../src/prompts/shrine-inspect.md', import.meta.url), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const NOW = 1800000000;
const COMMIT = 'c0ffee'.repeat(6) + 'c0ff';
const EM_DASH = String.fromCharCode(0x2014);

const CLAUDE_MD = '# Project rules\n\nUse npm.\n';
const B1_DIFF = `--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -1,3 +1,5 @@
 # Project rules

 Use npm.
+
+Run \`npm test\` before you say a task is done.
`;
const INDEX = `---
title: "Anti-patterns"
---

## Context and Memory

| Symptom | Fix |
| --- | --- |
| An always-loaded file buries the signal | [Memory](/SHRINE/stack/memory/) |

## Review and Verification

| Symptom | Fix |
| --- | --- |
| Done is claimed without running tests | [Verification Loops](/SHRINE/patterns/verification-loops/) |
`;
const PAGES = {
	'North Star: TTV (Tokens to Value)': { section: 'principles', status: 'ratified', body: '# TTV\n', url: 'principles/tokens-to-value/' },
	'Fail Fast, Recover Smart': { section: 'principles', status: 'ratified', body: '# FF\n', url: 'principles/fail-fast-recover-smart/' },
	'Deliberate Currency': { section: 'principles', status: 'ratified', body: '# DC\n', url: 'principles/deliberate-currency/' },
	'Correction Diagnosis': { section: 'patterns', status: 'ratified', body: '# CD\n', url: 'patterns/correction-diagnosis/' },
	'Verification Loops': { section: 'patterns', status: 'ratified', body: '# VL\n', url: 'patterns/verification-loops/' },
	'Anti-patterns': { section: 'reference', status: null, body: INDEX, url: 'reference/anti-patterns/' },
};
// Items the agent supplies as evidence; every other item is computed by the checker.
const EVIDENCE = ['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.12', '2.2', '2.5', '2.7', '2.8', '2.9', '2.11', '3.3', '4.3'];

// Fixture git calls ignore the machine's git config and hooks: a global hook or signing setup can add
// seconds to every commit, and the tests must not depend on it.
const GIT_ISOLATED = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd, ...args) {
	return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: GIT_ISOLATED });
}

function run(args, input) {
	const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8', input, env: { ...process.env, SHRINE_CHECK_NOW: String(NOW) } });
	return { code: r.status, out: r.stdout, err: r.stderr };
}

// A proposal's design hash, as the checker computes it: every field except its review.
const design = (x) => sha(JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'review'))));
function reviewed(x, n, opts = {}) {
	const d = design(x);
	x.review = { reviewers: Array.from({ length: n }, (_, i) => ({ who: `reviewer ${i + 1}`, how: 'subagent', design_sha256: d, checks_undo: !!opts.undo && i === 0, findings: [] })) };
	return x;
}

// The fixture's temporary folder must lie outside every git work tree, as the checker requires.
function insideRepo(dir) {
	for (let d = dir; ; d = dirname(d)) {
		if (existsSync(join(d, '.git'))) return true;
		if (dirname(d) === d) return false;
	}
}
const TMP = [process.env.SHRINE_TEST_TMP, tmpdir(), '/tmp'].filter(Boolean).map((d) => realpathSync(d)).find((d) => !insideRepo(d));

// The fixture's git project is built once, then copied for each test (git init + commit costs
// hundreds of milliseconds, more with slow hooks).
let template;
function projTemplate() {
	if (template) return template;
	const dir = join(realpathSync(mkdtempSync(join(TMP, 'shrine-tpl-'))), 'proj');
	mkdirSync(dir);
	writeFileSync(join(dir, 'CLAUDE.md'), CLAUDE_MD);
	writeFileSync(join(dir, '.gitignore'), 'local.json\n');
	writeFileSync(join(dir, 'local.json'), '{"model":"x"}\n');
	writeFileSync(join(dir, 'app.js'), 'console.log(1)\n');
	git(dir, 'init', '-q');
	git(dir, 'add', '.');
	git(dir, 'commit', '-q', '-m', 'init');
	return (template = dir);
}

function fixture() {
	assert.ok(TMP, 'no temporary folder outside a git work tree: set SHRINE_TEST_TMP');
	const base = realpathSync(mkdtempSync(join(TMP, 'shrine-')));
	const proj = join(base, 'proj');
	const out = join(base, 'out');
	mkdirSync(proj);
	mkdirSync(join(out, 'pages'), { recursive: true });
	cpSync(projTemplate(), proj, { recursive: true });
	const pages = [];
	const planPages = [];
	for (const [title, p] of Object.entries(PAGES)) {
		const file = join(out, 'pages', `${sha(title).slice(0, 8)}.md`);
		writeFileSync(file, p.body);
		pages.push({ title, description: null, section: p.section, status: p.status, url: `https://stablekernel.github.io/SHRINE/${p.url}`, source: null, sha256: sha(p.body) });
		planPages.push({ title, file });
	}
	writeFileSync(join(out, 'shrine-check.mjs'), CHECKER_SRC);
	const manifest = {
		commit: COMMIT,
		prompt: { version: 18, sha256: sha(PROMPT), url: 'https://stablekernel.github.io/SHRINE/inspect-prompt.md', source: null },
		checker: { url: 'https://stablekernel.github.io/SHRINE/shrine-check.mjs', source: null, sha256: sha(CHECKER_SRC) },
		pages,
	};
	const manifestPath = join(out, 'manifest.json');
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	const fx = { base, proj, out, manifestPath, manifest, planPath: join(out, 'test-harness.tester.plan.json') };
	fx.plan = planFor(fx, planPages);
	return fx;
}

function s1Text(fx) {
	const r = run(['--render', 's1', '--plan', '-', '--manifest', fx.manifestPath], JSON.stringify(fx.plan));
	return r.out.split('\n').filter((l) => l && !/^--- /.test(l)).join('\n') + '\n';
}

function planFor(fx, planPages) {
	const evidence = {};
	for (const id of EVIDENCE) evidence[id] = { mark: 'x', text: `evidence for ${id}`, source: '(plan)' };
	const tradeoff = { costs: 'one line per session', saves: 'a review round', net: 'positive: fewer swaps', flag: false };
	const plan = {
		schema: 2,
		run: 'inspect',
		mode: 'interactive',
		delivery: 'inline',
		delivery_reason: 'test fixture reads stdout',
		time: { start: NOW - 20 * 60, start_source: '$ date +%s', agreed: 45 },
		harness: { name: 'test-harness', version: '1.0.0' },
		user: 'tester',
		answered_by: 'tester',
		models: { discovery: 'small tier', design: 'strongest', review: 'strongest' },
		project_root: fx.proj,
		out_dir: fx.out,
		scope: { choice: 'only this project', roots: [fx.proj], quote: 'only this project' },
		approvals: { 1: 'approve gate 1', 2: 'approve gate 2' },
		checker: { file: join(fx.out, 'shrine-check.mjs') },
		persist: { source: '$ ls ~/.test-harness', features: [] },
		load: [{ path: 'CLAUDE.md', loads: 'yes', source: '(probe: harness -p "list loaded files")', probe: { how: 'non-interactive run', readonly: true } }],
		readonly: { watch: [{ path: 'local.json', kind: 'config' }], baselines: [] },
		pages: planPages,
		scan: [{ row: 'Review and Verification / Done is claimed without running tests', evidence: 'no test step in CLAUDE.md', source: '$ grep -c test CLAUDE.md', outcome: 'proposal B1' }],
		signals: { consent: 'declined' },
		corrections: [{ text: 'agent said done without tests', origin: 'recalled', class: 'repeated', tag: 'verification', symptom: 'no test run before done' }],
		answers: { delegation: 'short tasks', review: 'reads diffs' },
		evidence,
		principles: [
			{ title: 'North Star: TTV (Tokens to Value)', status: 'applied', proposals: ['B1'], reason: 'fewer review swaps' },
			{ title: 'Fail Fast, Recover Smart', status: 'applied', proposals: ['B1'], reason: 'tests catch misses early' },
			{ title: 'Deliberate Currency', status: 'applied', proposals: ['S1', 'S2'], reason: 'refresh when SHRINE moves' },
		],
		baseline: { offer: 'yes, start it' },
		report: { top_practices: [{ practice: 'Run tests before done', page: 'Verification Loops' }] },
		proposals: [],
	};
	const b1 = {
		id: 'B1', group: 'Verification', value: 'high', title: 'Run tests before done', plain: 'Adds one line to the project rules: run the tests before saying a task is done.', page: 'Verification Loops', row: 'Done is claimed without running tests',
		answer: 'repeated correction: done without tests (recalled)', principles: ['Fail Fast, Recover Smart'], model: 'strongest',
		changes: [{ target: 'CLAUDE.md', diff: B1_DIFF }], runs_code: false,
		blast: { committed: true, reaches: 'everyone who uses this repo' },
		load: { always_loaded: true, miss: 'done claimed without tests', expect: 'every session in this project', verify: 'ask a fresh session what it must do before done' },
		tradeoff,
	};
	plan.proposals.push(reviewed(b1, 2));
	fx.plan = plan;
	const s1 = {
		id: 'S1', group: 'SHRINE upkeep', value: 'medium', title: 'SHRINE refresh entry', page: 'Deliberate Currency', answer: 'every inspection report carries upkeep', model: 'strongest',
		mechanism: 'command', invocation: '/shrine-refresh', plain: 'Adds a command you type to check SHRINE for updates and compare with this inspection report.',
		changes: [{ target: '.claude/commands/shrine-refresh.md', content: s1Text(fx) }], runs_code: false,
		blast: { committed: false, reaches: 'only you' },
		load: { always_loaded: false, expect: 'when you type /shrine-refresh', verify: 'type /shrine-refresh and see the steps' },
		tradeoff,
	};
	plan.proposals.push(reviewed(s1, 1));
	const s2 = {
		id: 'S2', group: 'SHRINE upkeep', value: 'low', title: 'Staleness check', plain: 'Adds a check that tells you in one line, at session start, when SHRINE has changed.', page: 'Deliberate Currency', answer: 'every inspection report carries upkeep', model: 'strongest',
		changes: [{ target: '.claude/hooks/shrine-stale.sh', content: `#!/bin/sh\n# SHRINE staleness check: pinned commit ${COMMIT}\n# When SHRINE moved, run /shrine-refresh\n` }],
		runs_code: true, runtime_writes: [], undo: 'delete the hook file and its settings entry',
		blast: { committed: false, reaches: 'only you, at session start' },
		load: { always_loaded: false, expect: 'once per session start', verify: 'start a session and see one line when SHRINE moved' },
		tradeoff: { costs: 'one fetch per session', saves: 'stale practice', net: 'positive', flag: true, dimensions: ['currency', 'latency'] },
	};
	plan.proposals.push(reviewed(s2, 2, { undo: true }));
	return plan;
}

function save(fx) {
	writeFileSync(fx.planPath, JSON.stringify(fx.plan, null, 2));
}

// Take a read-only baseline and record it, as the agent does at Phase 0 and after discovery.
function baseline(fx) {
	save(fx);
	const r = run(['--render', 'baseline', '--plan', fx.planPath, '--out', fx.out]);
	assert.equal(r.code, 0, r.err);
	const file = /render file: (.+)/.exec(r.out)[1];
	fx.plan.readonly.baselines.push({ file, sha256: /render sha256:([0-9a-f]{64})/.exec(r.out)[1] });
	save(fx);
	return r;
}

function ready() {
	const fx = fixture();
	baseline(fx);
	return fx;
}

const check = (fx) => run(['--check', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
const gate = (fx, n) => run(['--render', 'gate', '--gate', String(n), '--plan', fx.planPath, '--manifest', fx.manifestPath]);
const item = (out, id) => out.split('\n').find((l) => new RegExp(`^\\[.\\] ${id.replace('.', '\\.')} `).test(l)) ?? '';

function reportFile(fx) {
	fx.plan.delivery = 'file';
	delete fx.plan.delivery_reason;
	save(fx);
	const r = run(['--render', 'report', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	const file = /report file: (.+)/.exec(r.out)?.[1];
	return { r, file, sha256: /render sha256:([0-9a-f]{64})/.exec(r.out)?.[1] };
}

// ---------- the full run ----------

test('a complete plan passes every check', () => {
	const fx = ready();
	const r = check(fx);
	assert.equal(r.code, 0, r.out);
	for (const name of ['plan-shape', 'out-dir', 'read-only', 'scope', 'changes', 'coverage', 'review', 'scan', 'upkeep', 'secrets', 'plan-hashes']) assert.match(r.out, new RegExp(`^PASS ${name}:`, 'm'), name);
	assert.match(r.out, /RESULT: PASS/);
});

test('gates 0 to 3 render from the plan; gates 1 and 2 wait for approval until the user gives it', () => {
	const fx = ready();
	for (const n of [0, 1, 2, 3]) {
		const r = gate(fx, n);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, new RegExp(`^GATE ${n} of 3: \\S.*: PASS$`, 'm'), r.out);
	}
	delete fx.plan.approvals['2'];
	save(fx);
	assert.match(gate(fx, 2).out, /GATE 2 of 3: Pin and Interview: WAITING FOR APPROVAL/);
	const g3 = gate(fx, 3);
	assert.equal(g3.code, 1);
	assert.match(g3.out, /Approved: \[ \] missing: the user's approval of gate 2/);
});

test('the checker renders exactly the prompt\'s gate items, in order', () => {
	const gates = {};
	for (const m of PROMPT.matchAll(/^Gate (\d) items:\n\n((?:- .*\n)+)/gm)) gates[m[1]] = [...m[2].matchAll(/^- (\d\.\d+) /gm)].map((x) => x[1]);
	const fin = [...PROMPT.split('**Final Gate.**')[1].matchAll(/^- (4\.\d+) /gm)].map((x) => x[1]);
	const fx = ready();
	for (const n of [0, 1, 2, 3]) {
		const ids = [...gate(fx, n).out.matchAll(/^\[.\] (\d\.\d+) /gm)].map((x) => x[1]);
		assert.deepEqual(ids, gates[n], `gate ${n}`);
	}
	const f = run(['--render', 'final', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.deepEqual([...f.out.matchAll(/^\[.\] (4\.\d+) /gm)].map((x) => x[1]), fin);
});

test('the checker\'s invariant map equals the prompt\'s Invariant Map', () => {
	const table = PROMPT.split('## Invariant Map')[1].split('## Data Plane')[0];
	const rows = [...table.matchAll(/^\| (\d+ [^|]+?) \| ([^|]+) \|$/gm)].map((m) => [m[1], m[2].split(',').map((s) => s.trim()).filter((s) => /^\d\.\d+$/.test(s))]);
	const fx = ready();
	const f = run(['--render', 'final', '--plan', fx.planPath, '--manifest', fx.manifestPath]).out;
	const map = [...f.matchAll(/^ {6}(\d+ [^:]+): (.+)$/gm)].filter((m) => /\[.\]/.test(m[2])).map((m) => [m[1], [...m[2].matchAll(/(\d\.\d+)\[/g)].map((x) => x[1])]);
	assert.deepEqual(map, rows);
});

test('prompt version is 18, and the prompt has no em dash', () => {
	assert.match(PROMPT, /^Prompt version: 18$/m);
	assert.ok(!PROMPT.includes(EM_DASH));
});

test('the Final Gate passes on a complete run with a current report', () => {
	const fx = ready();
	const rep = reportFile(fx);
	assert.equal(rep.r.code, 0, rep.r.out);
	fx.plan.report_file = { file: rep.file, sha256: rep.sha256 };
	for (const n of [0, 1, 2, 3]) {
		save(fx);
		const r = run(['--render', 'gate', '--gate', String(n), '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
		fx.plan.renders = { ...(fx.plan.renders ?? {}), [n]: { file: /render file: (.+)/.exec(r.out)[1], sha256: /render sha256:([0-9a-f]{64})/.exec(r.out)[1] } };
	}
	save(fx);
	const f = run(['--render', 'final', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.equal(f.code, 0, f.out);
	assert.match(f.out, /^FINAL GATE: PASS$/m);
	assert.match(item(f.out, '4.1'), /^\[x\] 4\.1 Read-only check: PASS/);
	assert.match(item(f.out, '4.2'), /^\[x\] 4\.2 Report: .*current, outside every scope root and repo/);
	assert.match(item(f.out, '4.4'), /12 of 12 invariants/);
});

// ---------- read-only: temp folder, baseline, verify ----------

test('verify-readonly passes when nothing changed', () => {
	const fx = ready();
	const r = run(['--verify-readonly', '--plan', fx.planPath]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /PASS \(1 repos, \d+ files, and 0 persistence paths compared with 1 baseline\)/);
});

test('verify-readonly fails on a changed tracked file, a new untracked file, and a changed ignored watched file', () => {
	for (const [what, act, want] of [
		['tracked', (fx) => writeFileSync(join(fx.proj, 'app.js'), 'console.log(2)\n'), /new status line " M app\.js"/],
		['untracked', (fx) => writeFileSync(join(fx.proj, 'notes.md'), 'x\n'), /new status line "\?\? notes\.md"/],
		['ignored watched', (fx) => writeFileSync(join(fx.proj, 'local.json'), '{}\n'), /changed: watched file .*local\.json/],
	]) {
		const fx = ready();
		act(fx);
		const r = run(['--verify-readonly', '--plan', fx.planPath]);
		assert.equal(r.code, 1, what);
		assert.match(r.out, want, what);
	}
});

test('verify-readonly fails on a further edit to an already dirty file, a new branch, and a commit', () => {
	let fx = fixture();
	writeFileSync(join(fx.proj, 'app.js'), 'dirty\n');
	baseline(fx);
	writeFileSync(join(fx.proj, 'app.js'), 'dirtier\n');
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /changed: .*app\.js/);
	fx = ready();
	git(fx.proj, 'branch', 'shrine-x');
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /branches, tags, notes, or stash changed/);
	fx = ready();
	git(fx.proj, 'commit', '-q', '--allow-empty', '-m', 'x');
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /HEAD or branch moved/);
});

test('verify-readonly: harness persistence the agent writes fails; automatic persistence is disclosed', () => {
	for (const automatic of [false, true]) {
		const fx = fixture();
		const mem = join(fx.base, 'harness', 'projects', 'proj', 'memory');
		mkdirSync(mem, { recursive: true });
		writeFileSync(join(mem, 'MEMORY.md'), 'old\n');
		fx.plan.persist.features = [{ feature: 'memory', path: mem, automatic }];
		baseline(fx);
		writeFileSync(join(mem, 'note.md'), 'new\n');
		const r = run(['--verify-readonly', '--plan', fx.planPath]);
		if (automatic) {
			assert.equal(r.code, 0, r.out);
			assert.match(r.out, /note: harness persistence .*note\.md changed on its own/);
		} else {
			assert.equal(r.code, 1);
			assert.match(r.out, /must not use harness memory or notes/);
		}
	}
});

test('verify-readonly: a watched file not in any baseline, a missing baseline, or an edited baseline fails', () => {
	let fx = fixture();
	writeFileSync(join(fx.proj, 'AGENTS.md'), 'x\n');
	git(fx.proj, 'add', 'AGENTS.md');
	git(fx.proj, 'commit', '-q', '-m', 'agents');
	baseline(fx);
	fx.plan.load.push({ path: 'AGENTS.md', loads: 'unverified' });
	save(fx);
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /AGENTS\.md is not in any baseline/);
	assert.match(item(gate(fx, 1).out, '1.13'), /^\[ \] 1\.13 .*not in any baseline/m);
	baseline(fx);
	assert.equal(run(['--verify-readonly', '--plan', fx.planPath]).code, 0);
	writeFileSync(fx.plan.readonly.baselines[0].file, 'edited\n');
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /baseline 1 is not a whole baseline render/);
	fx = fixture();
	save(fx);
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /no read-only baseline/);
	assert.match(item(gate(fx, 0).out, '0.9'), /^\[ \] 0\.9 /);
});

test('the Final Gate blocks when the read-only check fails', () => {
	const fx = ready();
	writeFileSync(join(fx.proj, 'stray.txt'), 'x\n');
	const f = run(['--render', 'final', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.equal(f.code, 1);
	assert.match(item(f.out, '4.1'), /^\[ \] 4\.1 Read-only check: FAIL/);
	assert.match(f.out, /FAIL read-only/);
});

test('out-dir: the temporary folder and the plan file must lie outside every scope root and repo', () => {
	const fx = ready();
	fx.plan.out_dir = fx.proj;
	save(fx);
	assert.match(check(fx).out, /FAIL out-dir[\s\S]*out_dir .* lies inside/);
	const other = join(fx.base, 'other');
	mkdirSync(other);
	git(other, 'init', '-q');
	fx.plan.out_dir = other;
	save(fx);
	assert.match(check(fx).out, /out_dir .* lies inside the git work tree/);
	fx.plan.out_dir = fx.out;
	const inside = join(fx.proj, 'plan.json');
	writeFileSync(inside, JSON.stringify(fx.plan));
	const r = run(['--check', '--plan', inside, '--manifest', fx.manifestPath]);
	assert.match(r.out, /plan file .* lies inside/);
});

test('render files: --out inside a scope root or a repo is refused; a render never overwrites a file', () => {
	const fx = ready();
	let r = run(['--render', 'time', '--plan', fx.planPath, '--out', fx.base]);
	assert.equal(r.code, 2);
	assert.match(r.err, /is not the plan's out_dir/);
	fx.plan.out_dir = fx.proj;
	save(fx);
	r = run(['--render', 'time', '--plan', fx.planPath, '--out', fx.proj]);
	assert.equal(r.code, 2);
	assert.match(r.err, /lies inside/);
	fx.plan.out_dir = fx.out;
	save(fx);
	const a = run(['--render', 'gate', '--gate', '0', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	const b = run(['--render', 'gate', '--gate', '0', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	assert.equal(/render file: (.+)/.exec(a.out)[1], /render file: (.+)/.exec(b.out)[1]);
	fx.plan.evidence['0.1'].text = 'changed';
	save(fx);
	const c = run(['--render', 'gate', '--gate', '0', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	assert.notEqual(/render file: (.+)/.exec(a.out)[1], /render file: (.+)/.exec(c.out)[1]);
	assert.match(c.out, /^--- end short gate 0 sha256:[0-9a-f]{64} ---$/m);
});

test('--plan - reads the plan from standard input, for a harness that cannot write a temporary file', () => {
	const fx = ready();
	const r = run(['--check', '--plan', '-', '--manifest', fx.manifestPath], JSON.stringify(fx.plan));
	assert.equal(r.code, 0, r.out);
	const rep = run(['--render', 'report', '--plan', '-', '--manifest', fx.manifestPath], JSON.stringify(fx.plan));
	assert.match(rep.out, /^--- shrine-check 9 report \(paste verbatim\) ---$/m);
	assert.match(rep.out, /^--- end report sha256:[0-9a-f]{64} ---$/m);
});

test('the checker source writes only render files and runs only read-only git commands', () => {
	const writes = [...CHECKER_SRC.matchAll(/\b(writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|createWriteStream)\(/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(writes)], ['writeFileSync']);
	for (const m of CHECKER_SRC.matchAll(/writeFileSync\([^;]+;/g)) assert.match(m[0], /flag: 'wx'/);
	assert.equal([...CHECKER_SRC.matchAll(/execFileSync\(/g)].length, 1);
	assert.doesNotMatch(CHECKER_SRC, /(?<![.\w])(spawn|spawnSync|exec|execSync|fork)\(/);
	const subs = [...CHECKER_SRC.matchAll(/(?:runGit\([^,]+, \[|'--no-optional-locks', )'([a-z-]+)'/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(subs)].sort(), ['apply', 'config', 'for-each-ref', 'rev-parse', 'status', 'symbolic-ref']);
	assert.match(CHECKER_SRC, /'core\.fsmonitor=false'/);
	assert.match(CHECKER_SRC, /\['apply', '--check', '-'\]/);
	assert.match(CHECKER_SRC, /'--no-optional-locks'/);
});

// ---------- patches ----------

test('changes: a diff that applies passes; stale context fails', () => {
	const fx = ready();
	assert.match(item(gate(fx, 3).out, '3.4'), /^\[x\] 3\.4 /);
	fx.plan.proposals[0].changes[0].diff = B1_DIFF.replace(' Use npm.', ' Use yarn.');
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	const r = check(fx);
	assert.match(r.out, /FAIL changes[\s\S]*B1 file 1 .*hunk 1 .* does not match the current file/);
	assert.match(item(gate(fx, 3).out, '3.4'), /^\[ \] 3\.4 /);
});

test('changes: a hunk at another line applies, and the inspection report carries its true line numbers', () => {
	const fx = ready();
	fx.plan.proposals[0].changes[0].diff = B1_DIFF.replace('@@ -1,3 +1,5 @@', '@@ -7,3 +7,5 @@');
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	assert.match(check(fx).out, /PASS changes/);
	const rep = reportFile(fx);
	assert.match(readFileSync(rep.file, 'utf8'), /^@@ -1,3 \+1,5 @@$/m);
});

test('changes: header counts, two files in one diff, and <redacted> context fail with the rule named', () => {
	for (const [diff, want] of [
		[B1_DIFF.replace('@@ -1,3 +1,5 @@', '@@ -1,3 +1,9 @@'), /its header says -3 \+9 lines, its body has -3 \+5/],
		[`${B1_DIFF}--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-console.log(1)\n+console.log(2)\n`, /one file per change/],
		[B1_DIFF.replace(' Use npm.', ' token=<redacted>'), /narrow the hunk so its context avoids the secret line/],
	]) {
		const fx = ready();
		fx.plan.proposals[0].changes[0].diff = diff;
		reviewed(fx.plan.proposals[0], 2);
		save(fx);
		assert.match(check(fx).out, want);
	}
});

test('changes: new contents for an existing file fail; a diff of a missing file fails; no newline at end of file round-trips', () => {
	let fx = ready();
	fx.plan.proposals[0].changes = [{ target: 'CLAUDE.md', content: 'x\n' }];
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	assert.match(check(fx).out, /exists: give a diff of it, not new contents/);
	fx = ready();
	fx.plan.proposals[0].changes = [{ target: 'MISSING.md', diff: B1_DIFF.replace(/CLAUDE\.md/g, 'MISSING.md') }];
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	assert.match(check(fx).out, /does not exist: give its exact contents as a new file/);
	fx = fixture();
	writeFileSync(join(fx.proj, 'app.js'), 'a\nb');
	git(fx.proj, 'commit', '-qam', 'noeol');
	baseline(fx);
	fx.plan.proposals[0].changes = [{ target: 'app.js', diff: '--- a/app.js\n+++ b/app.js\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n' }];
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	const r = check(fx);
	assert.match(r.out, /PASS changes/, r.out);
});

test('changes: every target lies inside the chosen scope roots', () => {
	const fx = ready();
	fx.plan.proposals[0].changes = [{ target: join(fx.base, 'elsewhere.md'), content: 'x\n' }];
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	assert.match(check(fx).out, /FAIL scope[\s\S]*outside the scope roots/);
	assert.match(item(gate(fx, 3).out, '3.15'), /^\[ \] 3\.15 /);
});

// ---------- review ----------

test('review: minimum reviewers by risk, and an undo check for code', () => {
	const fx = ready();
	fx.plan.proposals[0].review.reviewers.pop();
	save(fx);
	assert.match(check(fx).out, /B1: 1 reviewers of this design, shared needs at least 2/);
	fx.plan.proposals[2].review.reviewers[0].checks_undo = false;
	save(fx);
	assert.match(check(fx).out, /S2: runs code, so one reviewer must check its undo/);
	fx.plan.proposals[0].review = { reviewers: [], self_only: 'no subagent or second model in this harness' };
	fx.plan.proposals[2].review.reviewers[0].checks_undo = true;
	save(fx);
	assert.match(check(fx).out, /PASS review/);
});

test('review cap: at most 2 rounds per change; past the cap the user decides', () => {
	const fx = ready();
	const b1 = fx.plan.proposals[0];
	const round = (tag) => ({ who: `r-${tag}`, how: 'subagent', design_sha256: sha(tag), findings: [{ finding: 'f', resolution: 'changed' }] });
	b1.review.reviewers = [round('one'), round('two')];
	save(fx);
	let r = check(fx);
	assert.match(r.out, /B1: 2 review rounds used and 0 reviewers of this design.*escalate to the user/);
	b1.review.escalated = { quote: 'ship it as is; I will review it myself', design_sha256: design(b1) };
	save(fx);
	assert.match(check(fx).out, /PASS review/);
	b1.title = 'Run tests before you say done';
	save(fx);
	assert.match(check(fx).out, /B1: the escalation answered an earlier design/);
	b1.review.escalated.design_sha256 = design(b1);
	b1.review.reviewers.push(round('three'));
	save(fx);
	r = check(fx);
	assert.match(r.out, /B1: 3 review rounds; the hard cap is 2/);
	assert.match(item(gate(fx, 3).out, '3.9'), /^\[ \] 3\.9 /);
});

test('review cap in report-only mode: escalation goes to the inspection report with its reason', () => {
	const fx = ready();
	fx.plan.mode = 'report-only';
	const b1 = fx.plan.proposals[0];
	b1.review.reviewers = [1, 2].map((i) => ({ who: `r${i}`, how: 'subagent', design_sha256: sha(String(i)), findings: [] }));
	b1.review.escalated = { why: 'two rounds disagreed; the user decides when reading the inspection report', design_sha256: design(b1) };
	save(fx);
	assert.match(check(fx).out, /PASS review/);
	const rep = run(['--render', 'report', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.match(rep.out, /escalated to you: two rounds disagreed/);
});

test('render review prints each design hash with its round count', () => {
	const fx = ready();
	const r = run(['--render', 'review', '--plan', fx.planPath]);
	assert.match(r.out, new RegExp(`^B1 design sha256:${design(fx.plan.proposals[0])}; risk shared; 2 of at least 2 reviewers of this design; round 1 of at most 2$`, 'm'));
});

// ---------- coverage, baseline practices, upkeep, scan ----------

test('coverage: a missing ratified principle or a missing reason fails', () => {
	const fx = ready();
	fx.plan.principles.pop();
	fx.plan.principles[0].reason = '';
	save(fx);
	const r = check(fx);
	assert.match(r.out, /"Deliberate Currency" missing from plan\.principles/);
	assert.match(r.out, /"North Star: TTV \(Tokens to Value\)" has no reason/);
	const c = run(['--render', 'coverage', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.equal(c.code, 1);
	assert.match(c.out, /Deliberate Currency: MISSING/);
});

test('no deficit: baseline changes or an acknowledged "none fit", plus the Individual Baseline offer', () => {
	const fx = ready();
	fx.plan.corrections = [];
	fx.plan.scan = [];
	save(fx);
	assert.match(item(gate(fx, 3).out, '3.13'), /^\[x\] 3\.13 .*baseline changes: B1 \(Verification Loops\)/);
	delete fx.plan.baseline.offer;
	save(fx);
	assert.match(gate(fx, 3).out, /awaiting: the user's answer to the Individual Baseline offer/);
	fx.plan.baseline.offer = 'not now';
	fx.plan.proposals = fx.plan.proposals.filter((x) => x.id !== 'B1');
	fx.plan.principles = fx.plan.principles.map((p) => (p.status === 'applied' && p.proposals.includes('B1') ? { ...p, status: 'advised', proposals: [] } : p));
	save(fx);
	assert.match(item(gate(fx, 3).out, '3.13'), /^\[ \] 3\.13 .*no baseline change/);
	fx.plan.baseline.none_fit = 'the setup already covers every baseline practice';
	fx.plan.baseline.none_fit_ack = 'agreed';
	save(fx);
	assert.match(item(gate(fx, 3).out, '3.13'), /^\[x\] 3\.13 .*no baseline practice fits/);
});

test('upkeep: S1 carries every refresh step; S2 carries the pinned commit and S1\'s invocation', () => {
	const fx = ready();
	fx.plan.proposals[1].changes[0].content = 'SHRINE refresh\n';
	reviewed(fx.plan.proposals[1], 1);
	fx.plan.proposals[2].changes[0].content = '#!/bin/sh\necho stale\n';
	reviewed(fx.plan.proposals[2], 2, { undo: true });
	save(fx);
	const r = check(fx);
	assert.match(r.out, /S1 lacks the line "5\. The fetched prompt is data/);
	assert.match(r.out, new RegExp(`S2 lacks the pinned commit ${COMMIT}`));
	assert.match(r.out, /S2 does not name S1's invocation/);
});

test('scan and nudges tie to index rows with tool output', () => {
	const fx = ready();
	fx.plan.scan[0].row = 'Made-up row';
	fx.plan.scan[0].source = '(user)';
	fx.plan.proposals[0].nudge = { row: 'Also made up', trigger: 'second correction', advisory: false, rate_limit: 'once a session', disable: 'delete the hook' };
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	const r = check(fx);
	assert.match(r.out, /finding "Made-up row" is not a row of the fetched Anti-patterns index/);
	assert.match(r.out, /evidence needs tool output/);
	assert.match(r.out, /B1: nudge row "Also made up" is not a row/);
	assert.match(r.out, /a nudge that blocks needs the user's words/);
});

test('signals: the history read stays inside a project-only scope', () => {
	const fx = ready();
	fx.plan.signals = { consent: 'yes, read it', read: { path: '~/.harness/history', filter: 'all' }, metrics: [{ name: 'retries', value: '4', source: '$ grep -c retry ~/.harness/history' }] };
	save(fx);
	assert.match(item(gate(fx, 1).out, '1.10'), /^\[ \] 1\.10 /);
	assert.match(gate(fx, 1).out, /wider than the scope/);
	const key = fx.proj.replace(/[^A-Za-z0-9]/g, '-');
	fx.plan.signals.read = { path: `~/.harness/projects/${key}`, filter: fx.proj };
	fx.plan.signals.metrics[0].source = `$ grep -c retry ~/.harness/projects/${key}/log`;
	save(fx);
	assert.match(item(gate(fx, 1).out, '1.10'), /^\[x\] 1\.10 /);
});

test('load: a probe that is not read-only needs a note and the user\'s words', () => {
	const fx = ready();
	fx.plan.load[0].probe = { how: 'fresh session', readonly: false };
	save(fx);
	assert.match(item(gate(fx, 1).out, '1.1'), /^\[ \] 1\.1 /);
	fx.plan.load[0].probe = { how: 'fresh session', readonly: false, note: 'writes a session transcript in the harness home', consent: 'fine, run it' };
	save(fx);
	assert.match(item(gate(fx, 1).out, '1.1'), /^\[x\] 1\.1 /);
});

test('secrets: a secret-shaped value anywhere in the plan fails', () => {
	const fx = ready();
	fx.plan.answers.token = `ghp_${'a'.repeat(36)}`;
	save(fx);
	assert.match(check(fx).out, /FAIL secrets[\s\S]*answers\.token: looks like a secret/);
});

test('evidence without a source, or with a short hash, renders [ ] and blocks the gate', () => {
	const fx = ready();
	fx.plan.evidence['1.2'] = { mark: 'x', text: 'none found' };
	fx.plan.evidence['1.3'] = { mark: 'x', text: 'hook sha256:abc123', source: '(plan)' };
	save(fx);
	const g = gate(fx, 1);
	assert.equal(g.code, 1);
	assert.match(item(g.out, '1.2'), /no source/);
	assert.match(item(g.out, '1.3'), /short or malformed hash/);
});

test('time: used is computed from time.start and the checker clock; a typed figure fails', () => {
	const fx = ready();
	assert.match(run(['--render', 'time', '--plan', fx.planPath]).out, /time used: 20 of 45 min; 25 min left/);
	fx.plan.time.used = 5;
	save(fx);
	assert.equal(run(['--render', 'time', '--plan', fx.planPath]).code, 2);
});

test('file delivery: the next gate blocks until the previous gate\'s render is recorded; a re-render after approval blocks', () => {
	const fx = ready();
	fx.plan.delivery = 'file';
	delete fx.plan.delivery_reason;
	save(fx);
	assert.match(gate(fx, 1).out, /\[ \] Gate 0 shown: plan\.renders\["0"\] does not name/);
	const r0 = run(['--render', 'gate', '--gate', '0', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	fx.plan.renders = { 0: { file: /render file: (.+)/.exec(r0.out)[1], sha256: /render sha256:([0-9a-f]{64})/.exec(r0.out)[1] } };
	save(fx);
	const r1 = run(['--render', 'gate', '--gate', '1', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	fx.plan.renders[1] = { file: /render file: (.+)/.exec(r1.out)[1], sha256: /render sha256:([0-9a-f]{64})/.exec(r1.out)[1] };
	save(fx);
	assert.match(gate(fx, 2).out, /^Approved: "approve gate 1" \(user\) for render /m);
	fx.plan.evidence['1.2'].text = 'a different inventory';
	save(fx);
	assert.match(gate(fx, 1).out, /Gate 1 changed since its approval/);
	fx.plan.renders[1] = fx.plan.renders[0];
	fx.plan.evidence['1.2'].text = 'evidence for 1.2';
	save(fx);
	assert.match(gate(fx, 2).out, /is a render of gate 0, not gate 1/);
});

// ---------- the inspection report ----------

test('report: one markdown file outside the repo with every section, changes grouped and ordered by value', () => {
	const fx = ready();
	const rep = reportFile(fx);
	assert.equal(rep.r.code, 0, rep.r.out);
	assert.match(rep.r.out, /^REPORT: complete; 3 changes; read-only check PASS$/m);
	assert.ok(rep.file.startsWith(fx.out));
	const text = readFileSync(rep.file, 'utf8');
	const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
	assert.deepEqual(heads, ['Summary', 'Principle Coverage', 'Findings', 'Changes', 'How to Apply', 'How to Refresh', 'Report Data']);
	assert.match(text, /This run changed nothing\. Read-only check: PASS/);
	assert.match(text, /^\| \[Deliberate Currency\]\(https:\/\/stablekernel\.github\.io\/SHRINE\/principles\/deliberate-currency\/\) \| applied \| S1, S2 \|/m);
	assert.ok(text.indexOf('#### Change S1') < text.indexOf('#### Change S2'), 'medium before low');
	assert.ok(text.indexOf('### Verification') < text.indexOf('### SHRINE upkeep'), 'the group with a high-value patch first');
	assert.match(text, /> \*\*Runs code\.\*\* This change runs code with your account's full permissions/);
	for (const f of ['SHRINE page: \\[Verification Loops\\]', 'Anti-pattern row: Done is claimed', 'Trade-off:', 'Blast radius: committed or shared; reaches everyone', 'Loads: always loaded; prevents', 'Verify after applying:', 'Undo: reverse the diff'])
		assert.match(text, new RegExp(f));
	assert.ok(text.includes(`apply change B1 from ${rep.file}`));
	assert.match(text, /^- What it does: Adds one line to the project rules/m);
	assert.match(text, /^- By hand, a diff: open the file and make the edit it shows/m);
	assert.match(text, /^```diff$/m);
	const data = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]);
	assert.equal(data.commit, COMMIT);
	assert.deepEqual(data.patches.map((p) => p.id), ['B1', 'S1', 'S2']);
});

test('report: each diff in the inspection report applies with git apply --check from the folder it names', () => {
	const fx = ready();
	const text = readFileSync(reportFile(fx).file, 'utf8');
	const m = /`(\/[^`]+)`, a diff to apply from `([^`]+)`:\n\n<!-- shrine-change B1 1 -->\n(`{3,})diff\n([\s\S]*?)\n\3\n/.exec(text);
	assert.ok(m, 'B1 diff block');
	const r = spawnSync('git', ['apply', '--check', '-'], { cwd: m[2], input: `${m[4]}\n`, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
});

test('report: a plan edit after the inspection report blocks 4.2 until it is rendered again; unfilled lines block', () => {
	const fx = ready();
	const rep = reportFile(fx);
	fx.plan.report_file = { file: rep.file, sha256: rep.sha256 };
	fx.plan.answers.review = 'something new';
	save(fx);
	const f = run(['--render', 'final', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.match(f.out, /no longer matches the plan or the files: render the inspection report again/);
	fx.plan.report = {};
	save(fx);
	const r = run(['--render', 'report', '--plan', fx.planPath, '--manifest', fx.manifestPath, '--out', fx.out]);
	assert.equal(r.code, 1);
	assert.match(r.out, /report line not filled: - Top practices: <missing/);
});

test('report-only: user items render [-], changes are unconfirmed, and the offer goes in the inspection report', () => {
	const fx = ready();
	fx.plan.mode = 'report-only';
	delete fx.plan.evidence['0.4'];
	delete fx.plan.evidence['1.12'];
	delete fx.plan.baseline.offer;
	fx.plan.scope = { choice: 'only this project', roots: [fx.proj], why: 'cloud task: no user answers' };
	save(fx);
	assert.match(item(gate(fx, 0).out, '0.4'), /^\[-\] 0\.4 Time box agreed: not applicable: report-only/);
	assert.match(item(gate(fx, 1).out, '1.12'), /^\[-\] /);
	assert.match(gate(fx, 1).out, /^Approved: report-only$/m);
	assert.match(item(gate(fx, 2).out, '2.12'), /^\[x\] 2\.12 .*report-only: cloud task/);
	const rep = run(['--render', 'report', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.match(rep.out, /mode: report-only \(no user answers: every change is unconfirmed\)/);
	assert.match(rep.out, /Individual Baseline: start it so the next refresh compares/);
});

// ---------- refresh ----------

test('refresh: compares with the previous inspection report: SHRINE moved, pages changed, and which changes are applied', () => {
	const fx = ready();
	const prev = reportFile(fx).file;
	writeFileSync(join(fx.proj, 'CLAUDE.md'), `${CLAUDE_MD}\nRun \`npm test\` before you say a task is done.\n`);
	const fx2 = fixture();
	const man = JSON.parse(readFileSync(fx2.manifestPath, 'utf8'));
	man.commit = 'f'.repeat(40);
	man.pages.find((p) => p.title === 'Verification Loops').sha256 = sha('moved');
	writeFileSync(fx2.manifestPath, JSON.stringify(man));
	fx2.plan.run = 'refresh';
	fx2.plan.previous = { path: prev, source: '(user)' };
	save(fx2);
	const r = run(['--render', 'refresh', '--plan', fx2.planPath, '--manifest', fx2.manifestPath]);
	assert.equal(r.code, 0, r.out + r.err);
	assert.match(r.out, /previous commit c0ffee\S+, live f{40}: SHRINE moved/);
	assert.match(r.out, /1 pages changed since the previous inspection report: "Verification Loops"/);
	assert.match(r.out, /change B1 file 1 \(.*CLAUDE\.md\): applied/);
	assert.match(r.out, /change S1 file 1 \(.*shrine-refresh\.md\): not applied/);
	assert.match(item(gate(fx2, 1).out, '1.11'), /^\[x\] 1\.11 Previous report: /);
	fx2.plan.previous.path = join(fx2.out, 'nope.md');
	save(fx2);
	assert.match(item(gate(fx2, 1).out, '1.11'), /^\[ \] 1\.11 .*ask the user where they saved it/);
});

// ---------- review findings: escalation, reviewers, read-only edges ----------

test('review: an escalation before the cap does not count; the same reviewer twice counts once', () => {
	const fx = ready();
	const s2 = fx.plan.proposals[2];
	s2.review = { reviewers: [], escalated: { quote: 'skip review', design_sha256: design(s2) } };
	save(fx);
	assert.match(check(fx).out, /S2: 0 reviewers of this design, code needs at least 2/);
	reviewed(s2, 1, { undo: true });
	s2.review.reviewers.push({ ...s2.review.reviewers[0] });
	save(fx);
	assert.match(check(fx).out, /S2: 1 reviewers of this design, code needs at least 2/);
});

test('verify-readonly: a new ignored file, a new git hook, and a new file in a watched folder fail', () => {
	const fx = fixture();
	writeFileSync(join(fx.proj, '.gitignore'), 'local.json\n.env\n');
	git(fx.proj, 'commit', '-qam', 'ignore env');
	const cmds = join(fx.base, 'home-harness', 'commands');
	mkdirSync(cmds, { recursive: true });
	writeFileSync(join(cmds, 'review.md'), 'x\n');
	fx.plan.readonly.watch.push({ path: cmds, kind: 'folder' });
	baseline(fx);
	assert.equal(run(['--verify-readonly', '--plan', fx.planPath]).code, 0);
	writeFileSync(join(fx.proj, '.env'), 'X=1\n');
	writeFileSync(join(fx.proj, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
	writeFileSync(join(cmds, 'shrine.md'), 'x\n');
	const r = run(['--verify-readonly', '--plan', fx.planPath]);
	assert.equal(r.code, 1);
	assert.match(r.out, /new status line "!! \.env"/);
	assert.match(r.out, /new: .*\.git\/hooks\/pre-commit/);
	assert.match(r.out, /new file in a watched folder: .*shrine\.md/);
});

test('verify-readonly: every baseline in the temporary folder must be listed, so an early one cannot be dropped', () => {
	const fx = ready();
	mkdirSync(join(fx.base, 'extra'));
	writeFileSync(join(fx.base, 'extra', 'extra.md'), 'x\n');
	fx.plan.readonly.watch.push({ path: join(fx.base, 'extra', 'extra.md'), kind: 'config' });
	baseline(fx);
	fx.plan.readonly.baselines.shift();
	save(fx);
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /baseline file .*baseline-1\.txt is not in plan\.readonly\.baselines/);
});

test('verify-readonly: an inline baseline pasted into the plan is checked by its end-line hash', () => {
	const fx = fixture();
	save(fx);
	const r = run(['--render', 'baseline', '--plan', fx.planPath]);
	const end = /^--- end render baseline sha256:([0-9a-f]{64}) ---$/m.exec(r.out)[1];
	fx.plan.readonly.baselines.push({ text: r.out, sha256: end });
	save(fx);
	assert.equal(run(['--verify-readonly', '--plan', fx.planPath]).code, 0);
	fx.plan.readonly.baselines[0].text = r.out.replace('repo\t', 'repo\t ');
	save(fx);
	assert.match(run(['--verify-readonly', '--plan', fx.planPath]).out, /is not a whole baseline render/);
});

test('git commands run no repo code: a clean filter and an fsmonitor hook stay off', () => {
	const fx = fixture();
	const marker = join(fx.base, 'filter-ran');
	writeFileSync(join(fx.proj, '.gitattributes'), '*.js filter=probe\n');
	git(fx.proj, 'add', '.gitattributes');
	git(fx.proj, 'commit', '-qm', 'attrs');
	git(fx.proj, 'config', 'filter.probe.clean', `sh -c 'touch ${marker}; cat'`);
	git(fx.proj, 'config', 'core.fsmonitor', `sh -c 'touch ${marker}'`);
	spawnSync('touch', ['-t', '200001010000', join(fx.proj, 'app.js')]);
	baseline(fx);
	run(['--verify-readonly', '--plan', fx.planPath]);
	assert.ok(!existsSync(marker), 'a clean filter or fsmonitor hook ran');
});

test('changes: a diff of a CRLF file keeps its carriage returns', () => {
	const fx = fixture();
	writeFileSync(join(fx.proj, 'win.txt'), 'a\r\nb\r\n');
	git(fx.proj, 'add', 'win.txt');
	git(fx.proj, 'commit', '-qm', 'crlf');
	baseline(fx);
	fx.plan.proposals[0].changes = [{ target: 'win.txt', diff: '--- a/win.txt\n+++ b/win.txt\n@@ -1,2 +1,3 @@\n a\r\n b\r\n+c\r\n' }];
	reviewed(fx.plan.proposals[0], 2);
	save(fx);
	assert.match(check(fx).out, /PASS changes/);
});

// ---------- input ----------

test('pages: a fetched page that does not match the manifest blocks 2.3 and 3.1', () => {
	const fx = ready();
	writeFileSync(fx.plan.pages.find((p) => p.title === 'Correction Diagnosis').file, 'tampered\n');
	assert.match(item(gate(fx, 2).out, '2.3'), /^\[ \] 2\.3 .*MISMATCH: abort/);
	assert.match(item(gate(fx, 3).out, '3.1'), /^\[ \] 3\.1 /);
});

test('manifest: a local path and a file:// URL both work; plain http is refused', () => {
	const fx = ready();
	assert.equal(run(['--check', '--plan', fx.planPath, '--manifest', pathToFileURL(fx.manifestPath).href]).code, 0);
	const r = run(['--check', '--plan', fx.planPath, '--manifest', 'http://127.0.0.1/m.json']);
	assert.equal(r.code, 2);
	assert.match(r.err, /https URL or a local file/);
});

test('usage errors and a malformed plan exit 2', () => {
	assert.equal(run([]).code, 2);
	assert.equal(run(['--render', 'gate', '--plan', 'x']).code, 2);
	assert.equal(run(['--check', '--plan', 'x']).code, 2);
	const fx = ready();
	fx.plan.schema = 1;
	save(fx);
	const r = run(['--render', 'gate', '--gate', '0', '--plan', fx.planPath, '--manifest', fx.manifestPath]);
	assert.equal(r.code, 2);
	assert.match(r.err, /plan\.schema must be 2/);
	assert.ok(readdirSync(fx.out).length > 0);
});

// ---------- no git: a folder of documents, or an app's settings ----------

// A fixture whose project folder is not a git repo.
function noGit() {
	const fx = fixture();
	rmSync(join(fx.proj, '.git'), { recursive: true, force: true });
	baseline(fx);
	return fx;
}

test('no git: the read-only check hashes the project folder and every watched file, and passes when nothing changed', () => {
	const fx = noGit();
	const r = run(['--verify-readonly', '--plan', fx.planPath]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /PASS \(0 repos, \d+ files/);
	assert.match(r.out, /note: no git repo: the project folder .* compared by hash/);
	assert.equal(check(fx).code, 0, check(fx).out);
});

test('no git: a new, changed, or deleted file in the project folder fails the read-only check', () => {
	for (const [act, want] of [
		[(fx) => writeFileSync(join(fx.proj, 'notes.md'), 'x\n'), /new file in a watched folder: .*notes\.md/],
		[(fx) => writeFileSync(join(fx.proj, 'app.js'), 'console.log(2)\n'), /changed: watched file .*app\.js/],
		[(fx) => rmSync(join(fx.proj, 'CLAUDE.md')), /changed: watched file .*CLAUDE\.md .*-> absent/],
	]) {
		const fx = noGit();
		act(fx);
		const r = run(['--verify-readonly', '--plan', fx.planPath]);
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, want);
	}
});

test('no git: diffs are still checked to apply, and the inspection report explains how to apply without git', () => {
	const fx = noGit();
	assert.match(check(fx).out, /^PASS changes:/m);
	const text = readFileSync(reportFile(fx).file, 'utf8');
	assert.match(text, /^- To apply: ask your assistant, "apply change B1 from /m);
	assert.match(text, /Lines that start with `\+` are added/);
});

test('every change needs a plain-language description', () => {
	const fx = ready();
	delete fx.plan.proposals[0].plain;
	save(fx);
	const r = check(fx);
	assert.equal(r.code, 1);
	assert.match(r.out, /B1\.plain required: what the change does/);
});
