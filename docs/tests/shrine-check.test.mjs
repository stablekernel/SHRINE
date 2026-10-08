// Tests for src/tools/shrine-check.mjs. Run: npm test (Node built-in runner, no dependencies).
// Each test builds a fixture scope root in a temp folder: files, backups, fetched pages, a
// manifest, a record, and a plan file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKER = fileURLToPath(new URL('../src/tools/shrine-check.mjs', import.meta.url));
const PROMPT = readFileSync(new URL('../src/prompts/shrine-install.md', import.meta.url), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const MADE_UP = 'ab'.repeat(32);

const ORIGINAL = '# Project rules\n';
const AFTER_B1 = `${ORIGINAL}<!-- shrine:B1 -->\nRun tests before done.\n`;
const AFTER_B2 = `${AFTER_B1}<!-- shrine:B2 -->\nCite the failing test.\n`;
const NEW_FILE = '<!-- shrine:S2 -->\nSHRINE staleness check\n';
const INDEX = `---
title: "Anti-patterns"
---

## Context and Memory

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Output quality falls as the session ages | Never resetting a drifting session | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |

## Review and Verification

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Plausible code that does not run | No runnable check | [Verification Loops](/SHRINE/patterns/verification-loops/) |
`;
const site = (id) => `https://stablekernel.github.io/SHRINE/${id}/`;
const PAGES = [
	{ title: 'Correction Diagnosis', sha256: sha('page one'), section: 'patterns', status: null, url: site('patterns/correction-diagnosis') },
	{ title: 'Fail Fast, Recover Smart', sha256: sha('page two'), section: 'principles', status: 'ratified', url: site('principles/fail-fast-recover-smart') },
	{ title: 'North Star: TTV (Tokens to Value)', sha256: sha('north star'), section: 'principles', status: 'ratified', url: site('principles/tokens-to-value') },
	{ title: 'Human in the Loop', sha256: sha('hitl'), section: 'principles', status: 'ratified', url: site('principles/human-in-the-loop') },
	{ title: 'Draft Idea', sha256: sha('draft'), section: 'principles', status: 'draft', url: site('principles/draft-idea') },
	{ title: 'Anti-patterns', sha256: sha(INDEX), section: 'reference', status: null, url: site('reference/anti-patterns') },
];
const RATIFIED = PAGES.filter((p) => p.status === 'ratified').map((p) => p.title);

// Item ids per gate, parsed from the prompt itself, so the tests follow the prompt.
function promptItems() {
	const gates = {};
	for (const m of PROMPT.matchAll(/^Gate (\d) items:\n\n((?:- .*\n)+)/gm)) gates[m[1]] = [...m[2].matchAll(/^- (\d\.\d+) /gm)].map((x) => x[1]);
	const fin = PROMPT.split('**Final Gate.**')[1];
	gates['6'] = [...fin.matchAll(/^- (6\.\d+) /gm)].map((x) => x[1]);
	return gates;
}
const ITEMS = promptItems();
// Items the checker computes in full; the agent adds no evidence line for them.
const RENDERED = ['2.1', '2.3', '2.4', '2.7', '3.7', '4.1', '4.5', '4.9', '4.11', '4.12', '4.16', '4.17', '4.18', '4.19', '4.21', '5.1', '5.2', '5.3', '5.7', '5.10', '5.11', '6.1', '6.3', '6.4', '6.5', '6.8'];

const entry = (over) => ({
	id: 'X',
	target: 'CLAUDE.md',
	scope: 'locally only',
	ack: 'only me',
	marker: '<!-- shrine:X -->',
	status: 'done',
	teaching: 'Verification Loops',
	undo: 'remove the marked block',
	before_sha256: null,
	after_sha256: null,
	backup: null,
	page_sha256: PAGES[0].sha256,
	...over,
});

const opt = (affects, files) => ({ affects, files });
const proposal = (over) => ({
	id: 'P',
	title: 'A proposal',
	page: 'Correction Diagnosis',
	answer: 'correction (a)',
	targets: ['CLAUDE.md'],
	runs_code: false,
	always_loaded: true,
	miss: 'skipped tests',
	tradeoff: { costs: '30 tokens per session', saves: 'one review swap a week', net: 'positive', flag: true, dimensions: ['attention', 'tokens'] },
	risk: 'local text',
	model: 'strongest tier',
	review: { reviewers: [{ who: 'second model', how: 'subagent', findings: [{ finding: 'line too vague', resolution: 'named the command' }] }] },
	options: {
		'in place': opt('you', ['CLAUDE.md']),
		'locally only': opt('you', ['CLAUDE.local.md']),
		'reviewable change': { ...opt('team after review', ['CLAUDE.md']), via: 'patch .shrine/patches/P.patch' },
	},
	preselected: null,
	pick: 'locally only',
	ack: 'only I am affected',
	decision: 'approved',
	quote: 'approve P 2',
	...over,
});

function planFor(root) {
	const evidence = {};
	for (const ids of Object.values(ITEMS)) for (const id of ids) if (!RENDERED.includes(id)) evidence[id] = { mark: 'x', text: `evidence for ${id}`, source: '(plan)' };
	evidence['6.6'] = { mark: '-', text: 'not an uninstall' };
	evidence['6.7'] = { mark: '-', text: 'not an uninstall' };
	return {
		schema: 1,
		run: 'install',
		mode: 'full',
		delivery: 'inline',
		delivery_reason: 'test fixture reads stdout',
		time: { used: 20, agreed: 45 },
		harness: { name: 'test-harness', version: '1.0.0' },
		user: 'tester',
		answered_by: 'tester',
		project_root: root,
		scope: { choice: 'only this project', roots: [root], quote: 'only this project' },
		approvals: { 0: 'approve gate 0', 1: 'approve gate 1', 3: 'approve gate 3', 4: 'approve gate 4' },
		bookkeeping: [{ record: '.shrine/test-harness.tester.json', backups: '.shrine/backups' }],
		load: [
			{ path: 'CLAUDE.md', loads: 'yes', source: '$ /memory', fresh: { session: 'fresh', after_write: true, loads: 'yes', source: '(probe: harness -p "list loaded files")', how: 'non-interactive run' } },
			{ path: 'AGENTS.md', loads: 'unverified' },
		],
		pages: [
			{ title: 'Correction Diagnosis', file: 'pages/cd.md' },
			{ title: 'Fail Fast, Recover Smart', file: 'pages/ff.md' },
		],
		evidence,
		principles: [
			{ title: 'North Star: TTV (Tokens to Value)', status: 'applied', proposals: ['B1'], reason: 'cuts review swaps' },
			{ title: 'Fail Fast, Recover Smart', status: 'advised', reason: 'run tests before review' },
			{ title: 'Human in the Loop', status: 'not relevant', reason: 'review already gates every merge' },
		],
		menus_sha256: null,
		report: {
			skipped_why: { C1: 'user kept their own rule' },
			paste_ready: 'none',
			top_practices: [
				{ practice: 'Run tests before done', page: 'Correction Diagnosis' },
				{ practice: 'Tag repeated corrections', page: 'Fail Fast, Recover Smart' },
				{ practice: 'Count attention in TTV', page: 'North Star: TTV (Tokens to Value)' },
			],
		},
		proposals: [
			proposal({ id: 'B1', title: 'Run tests before done' }),
			proposal({ id: 'B2', title: 'Cite the failing test', tradeoff: { costs: 'none', saves: 'a lookup', net: 'positive', flag: false } }),
			proposal({ id: 'C1', title: 'Other rule', targets: ['other.md'], always_loaded: false, pick: 'reject', ack: null, decision: 'rejected', quote: 'reject C1' }),
			proposal({ id: 'S1', title: 'SHRINE refresh command', targets: ['.claude/commands/shrine-refresh.md'], always_loaded: false, page: 'Fail Fast, Recover Smart',
				options: { 'in place': opt('you', ['.claude/commands/shrine-refresh.md']), 'locally only': { not_possible: 'commands have no local-only form' }, 'reviewable change': opt('team', ['.claude/commands/shrine-refresh.md']) }, pick: 'in place' }),
			proposal({ id: 'S2', title: 'Staleness check', targets: ['stale.md'], always_loaded: false, preselected: 'locally only', pick: 'in place' }),
		],
	};
}

function fixture(mutate = () => {}) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'shrine-check-')));
	mkdirSync(join(root, '.shrine', 'backups'), { recursive: true });
	mkdirSync(join(root, 'pages'));
	mkdirSync(join(root, 'tmp'));
	writeFileSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1'), ORIGINAL);
	writeFileSync(join(root, 'CLAUDE.md'), AFTER_B2);
	writeFileSync(join(root, 'stale.md'), NEW_FILE);
	writeFileSync(join(root, 'pages', 'cd.md'), 'page one');
	writeFileSync(join(root, 'pages', 'ff.md'), 'page two');
	writeFileSync(join(root, 'pages', 'ap.md'), INDEX);
	const manifest = {
		commit: 'c0ffee',
		prompt: { version: 11, sha256: sha('prompt') },
		checker: { url: 'https://stablekernel.github.io/SHRINE/shrine-check.mjs', sha256: sha('checker') },
		pages: PAGES,
	};
	const record = {
		schema: 1,
		prompt: { version: 11, sha256: sha('prompt') },
		commit: 'c0ffee',
		harness: { name: 'test-harness', version: '1.0.0' },
		user: 'tester',
		answered_by: 'tester',
		answers: { scope: 'this project' },
		pages: PAGES.slice(0, 2).map((p) => ({ title: p.title, sha256: p.sha256 })),
		entries: [
			entry({ id: 'B1', before_sha256: sha(ORIGINAL), after_sha256: sha(AFTER_B1), backup: '.shrine/backups/CLAUDE.md.1' }),
			entry({ id: 'B2', before_sha256: sha(AFTER_B1), after_sha256: sha(AFTER_B2) }),
			entry({ id: 'S2', target: 'stale.md', scope: 'in place', after_sha256: sha(NEW_FILE), page_sha256: PAGES[1].sha256 }),
			entry({ id: 'C1', target: 'other.md', scope: 'reject', status: 'rejected' }),
		],
	};
	const plan = planFor(root);
	mutate({ record, plan, manifest, root });
	const recordPath = join(root, '.shrine', 'test-harness.tester.json');
	const manifestPath = join(root, 'tmp', 'manifest.json');
	const planPath = join(root, 'tmp', 'plan.json');
	writeFileSync(manifestPath, JSON.stringify(manifest));
	writeFileSync(recordPath, JSON.stringify(record, null, 2));
	writeFileSync(planPath, JSON.stringify(plan, null, 2));
	return { root, recordPath, manifestPath, planPath, plan };
}

function run(args) {
	const res = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });
	return { code: res.status, out: res.stdout + res.stderr };
}

// Render the menus, then store the end-line hash in the plan, as the prompt tells the agent to.
function showMenus(f) {
	const m = run(['--render', 'menus', '--plan', f.planPath]);
	const hash = /--- end render menus sha256:([0-9a-f]{64}) ---/.exec(m.out)[1];
	const plan = JSON.parse(readFileSync(f.planPath, 'utf8'));
	plan.menus_sha256 = hash;
	writeFileSync(f.planPath, JSON.stringify(plan));
	return m;
}

function withFixture(mutate, fn) {
	const f = fixture(mutate);
	try {
		return fn(f);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
}

function check(mutate, extra = ['--post-apply']) {
	return withFixture(mutate, (f) => run(['--record', f.recordPath, '--manifest', f.manifestPath, ...extra]));
}

// ---------- record checks (unchanged behavior from v9) ----------

test('valid record passes every check with full hashes', () => {
	const { code, out } = check();
	assert.equal(code, 0, out);
	assert.match(out, /RESULT: PASS \(12 of 12 checks passed\)/);
	assert.match(out, /PASS counts: pending 0; done 3 \(B1, B2, S2\); rejected 1 \(C1\)/);
	assert.match(out, new RegExp(`sha256:${sha(AFTER_B2)}`));
	assert.doesNotMatch(out, /FAIL/);
});

test('mismatched page hash fails page-hashes', () => {
	const { code, out } = check(({ record }) => (record.pages[0].sha256 = sha('edited page')));
	assert.equal(code, 1);
	assert.match(out, /FAIL page-hashes\n {2}- "Correction Diagnosis" record sha256:[0-9a-f]{64} != manifest sha256:[0-9a-f]{64}/);
});

test('made-up page hash in an entry fails page-hashes', () => {
	const { code, out } = check(({ record }) => (record.entries[0].page_sha256 = MADE_UP));
	assert.equal(code, 1);
	assert.match(out, new RegExp(`B1.page_sha256 sha256:${MADE_UP} matches no manifest page`));
});

test('made-up after hash fails targets as drift', () => {
	const { code, out } = check(({ record }) => (record.entries[1].after_sha256 = MADE_UP));
	assert.equal(code, 1);
	assert.match(out, /FAIL targets\n {2}- drift: .*CLAUDE\.md current sha256:[0-9a-f]{64} != B2\.after/);
});

test('shortened hash fails hash-format', () => {
	const { code, out } = check(({ record }) => (record.pages[1].sha256 = PAGES[1].sha256.slice(0, 16)));
	assert.equal(code, 1);
	assert.match(out, /FAIL hash-format\n {2}- pages\[1\] Fail Fast, Recover Smart "[0-9a-f]{16}" is not 64 lowercase hex/);
});

test('broken hash chain fails hash-chain', () => {
	const { code, out } = check(({ record }) => (record.entries[1].before_sha256 = sha(ORIGINAL)));
	assert.equal(code, 1);
	assert.match(out, /FAIL hash-chain\n {2}- B2\.before sha256:[0-9a-f]{64} != B1\.after/);
});

test('missing backup fails backups', () => {
	const { code, out } = check(({ root }) => rmSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1')));
	assert.equal(code, 1);
	assert.match(out, /FAIL backups\n {2}- B1: backup .*CLAUDE\.md\.1 missing/);
});

test('backup with wrong content fails backups', () => {
	const { code, out } = check(({ root }) => writeFileSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1'), 'changed'));
	assert.equal(code, 1);
	assert.match(out, /B1: backup .* sha256:[0-9a-f]{64} != before sha256:[0-9a-f]{64}/);
});

test('a later change that reuses the first backup fails and names the rule', () => {
	const { code, out } = check(({ record }) => (record.entries[1].backup = '.shrine/backups/CLAUDE.md.1'));
	assert.equal(code, 1);
	assert.match(out, /B2: backup .*CLAUDE\.md\.1 sha256:[0-9a-f]{64} != before sha256:[0-9a-f]{64}; this backup belongs to an earlier change .*a later change in the same run takes backup null/);
});

test('pending entry fails no-pending with --post-apply only', () => {
	const pend = ({ record, root }) => {
		record.entries[1].status = 'pending';
		writeFileSync(join(root, 'CLAUDE.md'), AFTER_B1);
	};
	const post = check(pend);
	assert.equal(post.code, 1);
	assert.match(post.out, /FAIL no-pending\n {2}- 1 pending: B2/);
	const pre = check(pend, []);
	assert.equal(pre.code, 0, pre.out);
	assert.doesNotMatch(pre.out, /no-pending/);
});

test('invalid blast-radius value fails blast-radius', () => {
	const { code, out } = check(({ record }) => (record.entries[0].scope = 'approve'));
	assert.equal(code, 1);
	assert.match(out, /FAIL blast-radius\n {2}- B1\.scope "approve" not one of: in place, locally only, reviewable change, reject/);
});

test('missing required field fails shape', () => {
	const { code, out } = check(({ record }) => {
		delete record.harness;
		delete record.entries[0].ack;
	});
	assert.equal(code, 1);
	assert.match(out, /FAIL shape\n {2}- harness\.name and harness\.version required\n {2}- B1\.ack required/);
});

test('record from another commit fails pin', () => {
	const { code, out } = check(({ record }) => (record.commit = 'deadbeef'));
	assert.equal(code, 1);
	assert.match(out, /FAIL pin\n {2}- record commit deadbeef != manifest commit c0ffee/);
});

test('uninstall mode: record absent and kept backups verified', () => {
	withFixture(undefined, (f) => {
		const backup = join(f.root, '.shrine', 'backups', 'record.json.1');
		writeFileSync(backup, readFileSync(f.recordPath));
		const present = run(['--uninstall', '--record', f.recordPath, '--record-backup', backup]);
		assert.equal(present.code, 1);
		assert.match(present.out, /FAIL record-absent/);
		rmSync(f.recordPath);
		const ok = run(['--uninstall', '--record', f.recordPath, '--record-backup', backup]);
		assert.equal(ok.code, 0, ok.out);
		assert.match(ok.out, /PASS backups: 1 kept backups equal their before hash/);
		const deleted = run(['--uninstall', '--record', f.recordPath, '--record-backup', backup, '--backups-deleted']);
		assert.equal(deleted.code, 1);
		assert.match(deleted.out, /still present after approved deletion/);
	});
});

// ---------- manifest sources ----------

test('manifest: a local path and a file:// URL both work; plain http is refused', () => {
	withFixture(undefined, (f) => {
		const path = run(['--record', f.recordPath, '--manifest', f.manifestPath]);
		assert.equal(path.code, 0, path.out);
		const url = pathToFileURL(f.manifestPath).href;
		const viaUrl = run(['--record', f.recordPath, '--manifest', url]);
		assert.equal(viaUrl.code, 0, viaUrl.out);
		assert.match(viaUrl.out, new RegExp(`manifest: ${url} sha256:[0-9a-f]{64}`));
		const http = run(['--record', f.recordPath, '--manifest', 'http://127.0.0.1:8793/SHRINE/shrine-manifest.json']);
		assert.equal(http.code, 2);
		assert.match(http.out, /https URL or a local file/);
	});
});

test('usage error exits 2', () => {
	assert.equal(run([]).code, 2);
	assert.equal(run(['--render', 'menus']).code, 2);
	assert.equal(run(['--render', 'gate', '--plan', 'p.json']).code, 2);
	assert.equal(run(['--render', 'nope', '--plan', 'p.json']).code, 2);
});

// ---------- plan checks: scope, load, coverage ----------

const planCheck = (mutate) => withFixture(mutate, (f) => run(['--record', f.recordPath, '--manifest', f.manifestPath, '--plan', f.planPath, '--post-apply']));

test('valid plan adds plan-shape, scope, load, and coverage checks, all PASS', () => {
	const { code, out } = planCheck();
	assert.equal(code, 0, out);
	assert.match(out, /RESULT: PASS \(19 of 19 checks passed\)/);
	assert.match(out, /PASS scope: every target, backup, and record path lies inside the scope roots/);
	assert.match(out, /PASS coverage: 3 ratified principles each have a status and a reason/);
});

test('scope: a backup outside the chosen scope roots fails (defect 5)', () => {
	const home = `~/.shrine/backups/shrine-test-${process.pid}/CLAUDE.md.1`;
	const { code, out } = planCheck(({ record }) => (record.entries[0].backup = home));
	assert.equal(code, 1);
	assert.match(out, new RegExp(`FAIL scope\\n {2}- B1 backup ${homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.shrine/backups/.* is outside the scope roots`));
});

test('scope: a proposal target or bookkeeping path outside the roots fails', () => {
	const { code, out } = planCheck(({ plan }) => {
		plan.proposals[0].targets = ['/etc/shrine-outside.md'];
		plan.bookkeeping[0].backups = '~/.shrine/backups';
	});
	assert.equal(code, 1);
	assert.match(out, /- B1 target \/etc\/shrine-outside\.md is outside the scope roots/);
	assert.match(out, /- bookkeeping backups .*\.shrine\/backups is outside the scope roots/);
});

test('load: a pre-write "unverified" is a hint only; the menus show it and the check passes', () => {
	withFixture(({ plan }) => (plan.proposals[1].targets = ['AGENTS.md']), (f) => {
		const chk = run(['--record', f.recordPath, '--manifest', f.manifestPath, '--plan', f.planPath, '--post-apply']);
		assert.match(chk.out, /PASS load:/);
		const m = run(['--render', 'menus', '--plan', f.planPath]);
		assert.match(m.out, /load hint: AGENTS\.md is "unverified" before the write; Phase 6 proves it loads in a fresh session/);
	});
});

test('load: a proof not marked fresh-session-after-write fails the load check (A3)', () => {
	const { code, out } = planCheck(({ plan }) => (plan.load[0].fresh = { session: 'current', after_write: false, loads: 'yes', source: '(probe: context block order)' }));
	assert.equal(code, 1);
	assert.match(out, /FAIL load\n {2}- CLAUDE\.md: a load proof counts only with session "fresh", after_write true/);
});

test('final 6.1: an always-loaded target without a fresh-session proof blocks; acceptance as not loading passes (A3)', () => {
	withFixture(({ plan }) => delete plan.load[0].fresh, (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 1);
		assert.match(out, /^\[ \] 6\.1 Changes load: 1 always-loaded targets/m);
		assert.match(out, /CLAUDE\.md: no load proof from a fresh session after the write/);
	});
	withFixture(({ plan }) => (plan.load[0].fresh = { session: 'fresh', after_write: true, loads: 'no', source: '(user)' }), (f) => {
		showMenus(f);
		const { out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.match(out, /^\[ \] 6\.1 /m);
		assert.match(out, /CLAUDE\.md: does not load in a fresh session/);
	});
	withFixture(({ plan }) => (plan.load[0].fresh = { accepted: 'fine, leave it not loading' }), (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 0, out);
		assert.match(out, /\[x\] 6\.1 .*\n {6}CLAUDE\.md: not loading, accepted: "fine, leave it not loading" \(user\)/);
	});
});

test('coverage: a missing ratified principle or a missing reason fails (defect 8)', () => {
	const { code, out } = planCheck(({ plan }) => {
		plan.principles = plan.principles.filter((p) => p.title !== 'Human in the Loop');
		delete plan.principles[1].reason;
	});
	assert.equal(code, 1);
	assert.match(out, /FAIL coverage\n/);
	assert.match(out, /- "Human in the Loop" missing from plan\.principles/);
	assert.match(out, /- "Fail Fast, Recover Smart" has no reason/);
	assert.doesNotMatch(out, /Draft Idea/);
});

test('coverage: an unflagged-or-flagged trade-off must be decided per proposal', () => {
	const { code, out } = planCheck(({ plan }) => {
		delete plan.proposals[0].tradeoff.flag;
		plan.proposals[1].tradeoff = { costs: 'x', saves: 'y', net: 'z', flag: true };
	});
	assert.equal(code, 1);
	assert.match(out, /- B1\.tradeoff needs costs, saves, net, and flag \(true or false\)/);
	assert.match(out, /- B2\.tradeoff\.flag is true: name both dimensions/);
});

test('render coverage prints one row per ratified principle', () => {
	withFixture(undefined, (f) => {
		const { code, out } = run(['--render', 'coverage', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(code, 0, out);
		for (const t of RATIFIED) assert.match(out, new RegExp(`^${t.replace(/[().:]/g, '\\$&')}: (applied|advised|not relevant)`, 'm'));
		assert.match(out, /3 ratified principles \(manifest\), 3 covered in the plan/);
	});
});

// ---------- render: menus, gates, final ----------

test('render menus: all four options for every proposal (defect 1)', () => {
	withFixture(undefined, (f) => {
		const { code, out } = run(['--render', 'menus', '--plan', f.planPath]);
		assert.equal(code, 0, out);
		for (const p of f.plan.proposals) {
			const block = out.split(`\n${p.id} `)[1].split('Pick 1, 2, 3, or 4')[0];
			for (const line of ['[1] in place', '[2] locally only', '[3] reviewable change', '[4] reject']) assert.ok(block.includes(line), `${p.id} lacks ${line}`);
		}
		assert.equal(out.match(/^ {2}\[4\] reject {14}affects: nobody; files: none$/gm).length, f.plan.proposals.length);
		assert.match(out, /\[2\] locally only {8}not possible: commands have no local-only form/);
		assert.match(out, /pre-selected: \[2\]/);
		assert.match(out, /trade-off \(attention vs tokens\): costs 30 tokens per session/);
		assert.match(out, /^--- end render menus sha256:[0-9a-f]{64} ---$/m);
		assert.doesNotMatch(out, /same as/i);
	});
});

test('gate 4 is BLOCKED until the rendered menus were shown, then lists every pick', () => {
	withFixture(undefined, (f) => {
		const before = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(before.code, 1, before.out);
		assert.match(before.out, /GATE 4 of 6: Design and Approve: BLOCKED/);
		assert.match(before.out, /\[ \] 4\.9 Blast radius and pick menus: menus not shown as rendered/);
		showMenus(f);
		const after = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(after.code, 0, after.out);
		assert.match(after.out, /GATE 4 of 6: Design and Approve: PASS/);
		for (const id of ['B1', 'B2', 'C1', 'S1', 'S2']) assert.match(after.out, new RegExp(`^ {6}${id}: \\[\\d\\] `, 'm'));
		assert.match(after.out, /S2 Staleness check: pre-selected \[2\]; \[1\] in place/);
		assert.match(after.out, /\[x\] 4\.1 Pages read: 2 lines below\n {6}"Correction Diagnosis" expected sha256:[0-9a-f]{64} actual sha256:[0-9a-f]{64} match/);
	});
});

test('gate 4 waits while a pick is open', () => {
	withFixture(({ plan }) => {
		plan.proposals[0].pick = null;
		plan.proposals[0].decision = null;
	}, (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(code, 0, out);
		assert.match(out, /GATE 4 of 6: Design and Approve: WAITING FOR APPROVAL/);
		assert.match(out, /B1: pick awaiting/);
	});
});

test('evidence without a source, or with a short hash, renders [ ] and blocks the gate (defects 3, 4)', () => {
	withFixture(({ plan }) => {
		plan.evidence['1.5'] = { mark: 'x', text: 'write yes, fetch yes, pause yes' };
		plan.evidence['1.12'] = { mark: 'x', text: 'snapshot sha256:b638a1f6', source: '$ shasum -a 256' };
		plan.evidence['1.6'] = { mark: 'x', text: 'make test at commit 93714f0f...', source: '$ grep Makefile' };
	}, (f) => {
		const { code, out } = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(code, 1, out);
		assert.match(out, /GATE 1 of 6: Discover the Environment: BLOCKED/);
		assert.match(out, /\[ \] 1\.5 .*no source/);
		assert.match(out, /\[ \] 1\.12 .*short or malformed hash "sha256:b638a1f6"/);
		assert.match(out, /\[ \] 1\.6 .*shortened hash/);
	});
});

test('gate 1 renders load status per instruction file; files listed in evidence are hashed by the checker', () => {
	withFixture(({ plan }) => (plan.evidence['1.12'] = { mark: 'x', text: 'snapshot', source: '$ shasum', files: ['CLAUDE.md'] }), (f) => {
		const { out } = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(out, /CLAUDE\.md: loads yes \(pre-write hint; Phase 6 proves load in a fresh session\) {2}\$ \/memory/);
		assert.match(out, /AGENTS\.md: loads unverified \(pre-write hint/);
		assert.match(out, new RegExp(`CLAUDE\\.md sha256:${sha(AFTER_B2)} {2}\\$ shrine-check sha256`));
	});
});

test('gate 3 renders the scope roots; a missing approval of the previous gate blocks', () => {
	withFixture(({ plan }) => delete plan.approvals['1'], (f) => {
		const g2 = run(['--render', 'gate', '--gate', '2', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g2.out, /Approved: \[ \] missing: the user's approval of gate 1/);
		assert.match(g2.out, /GATE 2 of 6: Pin SHRINE: BLOCKED/);
		assert.match(g2.out, /\[x\] 2\.7 Principles list: 3 ratified: Fail Fast, Recover Smart; North Star: TTV \(Tokens to Value\) \(North Star\); Human in the Loop/);
		const g3 = run(['--render', 'gate', '--gate', '3', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g3.out, new RegExp(`\\[x\\] 3\\.7 Scope roots: choice "only this project"; roots: ${f.root}`));
	});
});

test('gate 5 renders record, backups, changes, and the post-apply check with full hashes', () => {
	withFixture(undefined, (f) => {
		const { code, out } = run(['--render', 'gate', '--gate', '5', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 0, out);
		assert.match(out, /GATE 5 of 6: Apply: PASS\nApproved: "approve gate 4" \(user\)/);
		assert.match(out, /\[x\] 5\.3 Each change: 4 lines below\n {6}B1: CLAUDE\.md; done; before sha256:[0-9a-f]{64}; after sha256:[0-9a-f]{64}/);
		assert.match(out, /RESULT: PASS \(19 of 19 checks passed\)/);
		for (const m of out.matchAll(/sha256:([0-9a-f]*)/g)) assert.equal(m[1].length, 64, `short hash in: ${m[0]}`);
	});
});

test('render final: every item of Gates 0 to 6 listed, full hashes, checker re-run (defect 2)', () => {
	withFixture(undefined, (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 0, out);
		assert.match(out, /^FINAL GATE: PASS$/m);
		for (const ids of Object.values(ITEMS))
			for (const id of ids) assert.equal(out.match(new RegExp(`^\\[[x-]\\] ${id.replace('.', '\\.')} `, 'gm'))?.length, 1, `item ${id} once`);
		assert.doesNotMatch(out, /\d\.\d+-\d\.\d+|\d\.x\b/);
		for (const m of out.matchAll(/sha256:([0-9a-f]*)/g)) assert.equal(m[1].length, 64, `short hash in: ${m[0]}`);
		assert.match(out, /\[x\] 6\.8 Checker, final run: RESULT: PASS \(19 of 19 checks passed\)/);
		assert.match(out, /\[x\] 6\.3 Invariant Map: 13 of 13 invariants/);
		assert.match(out, /\[x\] 6\.5 Report: rendered from the record and plan\.report/);
		assert.match(out, /Handoff: say "SHRINE refresh" when SHRINE moves; re-run when one correction tag leads or a measured signal moves \(Individual Baseline: https:\/\/stablekernel\.github\.io\/SHRINE\/stack\/evaluation\/#individual-baseline\)/);
		assert.match(out, /Top practices: 1\. Run tests before done \(https:\/\/stablekernel\.github\.io\/SHRINE\/patterns\/correction-diagnosis\/\) 2\./);
		assert.match(out, /Skipped: C1 \(user kept their own rule\)/);
		assert.match(out, /whole-file restore of .*CLAUDE\.md: from .*CLAUDE\.md\.1, only when its current sha256 equals sha256:[0-9a-f]{64} \(first before\)/);
	});
});

test('render final is BLOCKED when an item is missing or the checker fails', () => {
	withFixture(({ plan }) => delete plan.evidence['3.2'], (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 1);
		assert.match(out, /^FINAL GATE: BLOCKED$/m);
		assert.match(out, /^\[ \] 3\.2 Who answered: missing from the plan$/m);
		assert.match(out, /1 Approval: .*3\.5\[x\]/);
	});
	withFixture(({ root }) => writeFileSync(join(root, 'stale.md'), 'drifted'), (f) => {
		showMenus(f);
		const { code, out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(code, 1);
		assert.match(out, /\[ \] 6\.8 Checker, final run: RESULT: FAIL/);
	});
});

test('uninstall: removal menus, gate 4 marks other items [-], final checks the record is gone', () => {
	withFixture(({ plan }) => {
		plan.run = 'uninstall';
		plan.proposals = [
			proposal({ id: 'R1', title: 'Remove B1 and B2 from CLAUDE.md', targets: ['CLAUDE.md'], tradeoff: undefined }),
			proposal({ id: 'R2', title: 'Delete stale.md', targets: ['stale.md'], tradeoff: undefined }),
		];
		plan.approvals['6.6'] = 'approve 6.6';
		plan.approvals['6.7'] = 'keep the backups';
		plan.evidence['6.6'] = { mark: 'x', text: 'record removed', source: '(user)' };
		plan.evidence['6.7'] = { mark: 'x', text: 'kept: .shrine/backups', source: '(user)' };
	}, (f) => {
		const menus = showMenus(f);
		assert.equal(menus.out.match(/\[4\] reject/g).length, 2);
		const g4 = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath]);
		assert.match(g4.out, /\[-\] 4\.11 Coverage: not applicable: uninstall path/);
		assert.match(g4.out, /\[x\] 4\.9 /);
		const backup = join(f.root, '.shrine', 'backups', 'record.json.1');
		writeFileSync(backup, readFileSync(f.recordPath));
		rmSync(f.recordPath);
		const fin = run(['--render', 'final', '--uninstall', '--plan', f.planPath, '--record', f.recordPath, '--record-backup', backup]);
		assert.equal(fin.code, 0, fin.out);
		assert.match(fin.out, /^FINAL GATE: PASS\nApproved: "approve 6\.6" \(6\.6\), "keep the backups" \(6\.7\) \(user\)/m);
		assert.match(fin.out, /\[-\] 5\.1 Record written per scope: removed under 6\.6\/6\.7/);
		assert.match(fin.out, /\[-\] 3\.1 Questions asked: not applicable: uninstall path/);
		assert.match(fin.out, /RESULT: PASS \(4 of 4 checks passed\)/);
	});
});

test('advice-only install: Gate 5 and the Final Gate render without a record', () => {
	withFixture(({ plan }) => {
		for (const id of ['5.1', '5.2', '5.3', '5.7', '5.10', '5.11', '6.4', '6.8']) plan.evidence[id] = { mark: '-', text: 'nothing approved for change: no record' };
	}, (f) => {
		showMenus(f);
		const g5 = run(['--render', 'gate', '--gate', '5', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(g5.code, 0, g5.out);
		assert.match(g5.out, /\[-\] 5\.11 Checker, post-apply: not applicable: nothing approved for change/);
		const fin = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(fin.code, 0, fin.out);
		assert.match(fin.out, /\[-\] 6\.8 Checker, final run: not applicable: nothing approved/);
		assert.match(fin.out, /Rerun the checker: no record was written/);
	});
});

test('report-only: items that need a user reply render [-] when the plan has no evidence', () => {
	withFixture(({ plan }) => {
		plan.mode = 'report-only';
		delete plan.evidence['0.4'];
	}, (f) => {
		const { out } = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(out, /^Approved: report-only$/m);
		const g0 = run(['--render', 'gate', '--gate', '0', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g0.out, /\[-\] 0\.4 Time box agreed: not applicable: report-only/);
	});
});

test('render refresh: versions, commits, changed pages, and prompt hash in full', () => {
	withFixture(({ manifest }) => {
		manifest.commit = 'beefcafe';
		manifest.prompt = { version: 12, sha256: sha('new prompt') };
		manifest.pages = manifest.pages.map((p) => (p.title === 'Correction Diagnosis' ? { ...p, sha256: sha('edited') } : p));
	}, (f) => {
		const prompt = join(f.root, 'tmp', 'prompt.md');
		writeFileSync(prompt, 'new prompt');
		const ok = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--prompt', prompt]);
		assert.equal(ok.code, 0, ok.out);
		assert.match(ok.out, /recorded prompt version 11, live 12: a newer prompt exists/);
		assert.match(ok.out, /recorded commit c0ffee, live beefcafe: SHRINE moved/);
		assert.match(ok.out, /"Correction Diagnosis" recorded sha256:[0-9a-f]{64}, live sha256:[0-9a-f]{64}/);
		assert.match(ok.out, /compare: https:\/\/github\.com\/stablekernel\/SHRINE\/compare\/c0ffee\.\.\.beefcafe/);
		writeFileSync(prompt, 'tampered');
		const bad = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--prompt', prompt]);
		assert.equal(bad.code, 1);
		assert.match(bad.out, /!= manifest prompt\.sha256: stop, report, and follow nothing/);
	});
});

// ---------- v11: render to file, render hashes, A0, fresh load, review, scan, nudges ----------

const outDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'shrine-out-')));
const shortOf = (out) => {
	const m = /render file: (.+)\nrender sha256:([0-9a-f]{64})/.exec(out);
	assert.ok(m, `no short block in: ${out}`);
	return { file: m[1], sha256: m[2] };
};

test('render to file: --out writes the full render and prints only a short block with path and sha256 (A1)', () => {
	withFixture(undefined, (f) => {
		const out = outDir();
		try {
			const args = ['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath];
			const full = run(args);
			const short = run([...args, '--out', out]);
			assert.equal(short.code, 0, short.out);
			const s = shortOf(short.out);
			const text = readFileSync(s.file, 'utf8');
			assert.equal(text, full.out, 'the file holds the full render');
			assert.equal(sha(text), s.sha256);
			assert.match(short.out, /^GATE 1 of 6: Discover the Environment: PASS$/m);
			assert.match(short.out, /^counts: 14 \[x\], 0 \[-\], 0 \[ \], 0 awaiting$/m);
			assert.ok(short.out.trim().split('\n').length <= 9, 'the short block stays short');
			assert.doesNotMatch(short.out, /1\.12 Snapshot/);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

test('render to file: never overwrites; an identical render reuses its file, a changed one gets a new file (A1)', () => {
	withFixture(undefined, (f) => {
		const out = outDir();
		try {
			const args = ['--render', 'menus', '--plan', f.planPath, '--out', out];
			const a = shortOf(run(args).out);
			const b = shortOf(run(args).out);
			assert.equal(a.file, b.file);
			const plan = JSON.parse(readFileSync(f.planPath, 'utf8'));
			plan.proposals[0].title = 'Run tests before you say done';
			writeFileSync(f.planPath, JSON.stringify(plan));
			const c = shortOf(run(args).out);
			assert.notEqual(c.file, a.file);
			assert.match(c.file, /menus-2\.txt$/);
			assert.equal(sha(readFileSync(a.file)), a.sha256, 'the first file is untouched');
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

test('render to file: --out inside a scope root is refused', () => {
	withFixture(undefined, (f) => {
		const { code, out } = run(['--render', 'menus', '--plan', f.planPath, '--out', join(f.root, 'tmp')]);
		assert.equal(code, 2);
		assert.match(out, /lies inside .*: render files go in the run's temporary folder, outside every scope/);
	});
});

test('file delivery: the next gate checks the approved render file and its sha256; 4.9 takes the menus file hash (A1)', () => {
	withFixture(({ plan }) => {
		plan.delivery = 'file';
		delete plan.delivery_reason;
	}, (f) => {
		const out = outDir();
		try {
			const missing = run(['--render', 'gate', '--gate', '2', '--plan', f.planPath, '--manifest', f.manifestPath]);
			assert.match(missing.out, /Approved: \[ \] "approve gate 1" \(user\), but plan\.renders\["1"\] does not name the render file the user approved/);
			const g1 = shortOf(run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath, '--out', out]).out);
			const menus = shortOf(run(['--render', 'menus', '--plan', f.planPath, '--out', out]).out);
			const plan = JSON.parse(readFileSync(f.planPath, 'utf8'));
			plan.renders = { 1: g1 };
			plan.menus_sha256 = menus.sha256;
			writeFileSync(f.planPath, JSON.stringify(plan));
			const ok = run(['--render', 'gate', '--gate', '2', '--plan', f.planPath, '--manifest', f.manifestPath]);
			assert.match(ok.out, new RegExp(`Approved: "approve gate 1" \\(user\\) for render ${g1.file} sha256:${g1.sha256}`));
			assert.match(ok.out, /GATE 2 of 6: Pin SHRINE: PASS/);
			const g4 = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
			assert.match(g4.out, new RegExp(`\\[x\\] 4\\.9 Blast radius and pick menus: menus shown: sha256:${menus.sha256}`));
			writeFileSync(g1.file, 'edited after approval');
			const bad = run(['--render', 'gate', '--gate', '2', '--plan', f.planPath, '--manifest', f.manifestPath]);
			assert.equal(bad.code, 1);
			assert.match(bad.out, /GATE 2 of 6: Pin SHRINE: BLOCKED/);
			assert.match(bad.out, /render file .* sha256:[0-9a-f]{64} != approved sha256:[0-9a-f]{64}/);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

test('render-hashes: the record stores approved render hashes and the checker verifies each file (A1)', () => {
	const out = outDir();
	const file = join(out, 'gate-4-1.txt');
	writeFileSync(file, 'the gate 4 render the user approved\n');
	const good = sha('the gate 4 render the user approved\n');
	try {
		const store = (h) => ({ record, plan }) => {
			record.renders = [{ gate: '4', file, sha256: h }];
			plan.renders = { 4: { file, sha256: h } };
		};
		const ok = planCheck(store(good));
		assert.equal(ok.code, 0, ok.out);
		assert.match(ok.out, /PASS render-hashes: 1 approved gate renders/);
		const bad = planCheck(store(MADE_UP));
		assert.equal(bad.code, 1);
		assert.match(bad.out, /FAIL render-hashes\n {2}- gate 4: render file .* sha256:[0-9a-f]{64} != stored sha256:a{0}(ab){32}/);
		const notInRecord = planCheck(({ plan }) => (plan.renders = { 4: { file, sha256: good } }));
		assert.match(notInRecord.out, /- gate 4: plan\.renders has it, the record's renders do not/);
		rmSync(file);
		const gonePlan = planCheck(store(good));
		assert.match(gonePlan.out, /- gate 4: render file .* missing/);
		const goneLater = check(({ record }) => (record.renders = [{ gate: '4', file, sha256: good }]));
		assert.equal(goneLater.code, 0, goneLater.out);
		assert.match(goneLater.out, /gate 4 .* not on this machine any more \(temporary folder\)/);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});

test('A0: a record update is a tracked entry with a backup; the checker covers it (A4)', () => {
	const OLD = '{"old":"record"}';
	const a0 = (over = {}) => ({ record, root }) => {
		writeFileSync(join(root, '.shrine', 'backups', 'record.json.1'), OLD);
		record.entries.push(entry({ id: 'A0', target: '.shrine/test-harness.tester.json', scope: 'locally only', record_update: true, before_sha256: sha(OLD), backup: '.shrine/backups/record.json.1', page_sha256: null, undo: 'restore the record from its backup', ...over }));
	};
	const ok = check(a0());
	assert.equal(ok.code, 0, ok.out);
	assert.match(ok.out, /PASS record-update: 1 record updates \(A0\)/);
	assert.match(ok.out, /PASS hash-chain: 2 targets/);
	assert.match(check(a0({ after_sha256: MADE_UP })).out, /FAIL record-update\n {2}- A0: a record update takes after_sha256 null/);
	assert.match(check(a0({ backup: null })).out, /- A0: a record update needs a backup of the record taken before it/);
	assert.match(check(a0({ target: 'CLAUDE.md' })).out, /- A0: record_update entry targets .*CLAUDE\.md, not the record/);
	assert.match(check(a0({ before_sha256: MADE_UP })).out, /- A0: record backup .* != before/);
	withFixture(a0(), (f) => {
		showMenus(f);
		const fin = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(fin.code, 0, fin.out);
		assert.match(fin.out, /A0 \(record update\): restore the record from its backup; whole-record restore from .*record\.json\.1, whose sha256 is sha256:[0-9a-f]{64}/);
		assert.match(fin.out, /A0: \.shrine\/test-harness\.tester\.json; done; before sha256:[0-9a-f]{64}; after not stored \(record update; see 5\.1\)/);
	});
});

test('review: reviewer minimums by risk, undo check for code, and "self only" (B1)', () => {
	const shared = planCheck(({ plan }) => (plan.proposals[0].risk = 'shared'));
	assert.equal(shared.code, 1);
	assert.match(shared.out, /FAIL review\n {2}- B1: 1 reviewers, shared needs at least 2, or mark the review "self only"/);
	const code = planCheck(({ plan }) => {
		plan.proposals[0].runs_code = true;
		plan.proposals[0].review.reviewers.push({ who: 'third model', how: 'separate session', findings: [] });
	});
	assert.match(code.out, /- B1: runs code, so one reviewer must check its undo/);
	const undo = planCheck(({ plan }) => {
		plan.proposals[0].runs_code = true;
		plan.proposals[0].review.reviewers.push({ who: 'third model', how: 'separate session', checks_undo: true, findings: [] });
	});
	assert.equal(undo.code, 0, undo.out);
	const self = planCheck(({ plan }) => (plan.proposals[0].review = { reviewers: [], self_only: 'no subagents or other models in this harness' }));
	assert.equal(self.code, 0, self.out);
	withFixture(({ plan }) => (plan.proposals[1].risk = 'shared'), (f) => {
		showMenus(f);
		const g4 = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(g4.code, 1);
		assert.match(g4.out, /\[ \] 4\.19 Model fit and adversarial review: /);
		assert.match(g4.out, /B2: designed by strongest tier; risk shared; 1 of at least 2 reviewers {2}\(plan\) \[1 reviewers, shared needs at least 2/);
		assert.match(g4.out, /finding: line too vague; resolution: named the command/);
	});
	withFixture(({ plan }) => (plan.proposals[0].review = { reviewers: [], self_only: 'no other model' }), (f) => {
		const m = run(['--render', 'menus', '--plan', f.planPath]);
		assert.match(m.out, /risk: local text; designed by: strongest tier; reviewed by: self only/);
	});
});

const SCAN = { row: 'Context and Memory / Output quality falls as the session ages', evidence: '412 lines always loaded', source: '$ wc -l CLAUDE.md', fix: 'Correction Diagnosis', outcome: 'proposal B1' };
const NUDGE = { row: 'Review and Verification / Plausible code that does not run', trigger: 'an edit with no test run after it', advisory: true, rate_limit: 'once per session', disable: 'delete the hook entry' };
const withIndex = (more = () => {}) => ({ plan }) => {
	plan.pages.push({ title: 'Anti-patterns', file: 'pages/ap.md' });
	plan.scan = [{ ...SCAN }];
	plan.proposals[0].nudge = { ...NUDGE };
	delete plan.evidence['1.13'];
	delete plan.evidence['4.20'];
	more(plan);
};

test('scan and nudges: findings and nudges tie to index rows with tool output (B2, B5)', () => {
	const ok = planCheck(withIndex());
	assert.equal(ok.code, 0, ok.out);
	assert.match(ok.out, /PASS scan: 1 anti-pattern findings and 1 nudges each tied to an index row/);
	withFixture(withIndex(), (f) => {
		showMenus(f);
		const g1 = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g1.out, /\[x\] 1\.13 Anti-pattern scan: 1 findings against the Anti-patterns index/);
		assert.match(g1.out, /"Context and Memory \/ Output quality falls as the session ages": 412 lines always loaded {2}\$ wc -l CLAUDE\.md; fix: Correction Diagnosis/);
		const g4 = run(['--render', 'gate', '--gate', '4', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g4.out, /\[x\] 4\.20 Scan findings resolved: "Context and Memory \/ Output quality falls as the session ages": proposal B1/);
		assert.match(g4.out, /\[x\] 4\.21 Nudges: B1: "Review and Verification \/ Plausible code that does not run"; when an edit with no test run after it; advisory; at most once per session; turn off: delete the hook entry; runs code: no/);
		const m = run(['--render', 'menus', '--plan', f.planPath]);
		assert.match(m.out, /nudge for "Review and Verification \/ Plausible code that does not run": when an edit with no test run after it; advisory/);
	});
	const bad = planCheck(withIndex((plan) => {
		plan.scan.push({ ...SCAN, row: 'Made up / Not in the index' });
		plan.scan.push({ ...SCAN, source: '(user)' });
		plan.scan.push({ ...SCAN, outcome: 'proposal Z9' });
		plan.proposals[0].nudge.advisory = false;
	}));
	assert.equal(bad.code, 1);
	assert.match(bad.out, /- finding "Made up \/ Not in the index" is not a row of the fetched Anti-patterns index/);
	assert.match(bad.out, /evidence needs tool output \(\$ <command> or \(probe: \.\.\.\)\), not recall/);
	assert.match(bad.out, /outcome names unknown proposal Z9/);
	assert.match(bad.out, /- B1: a nudge that blocks needs the user's words asking for it/);
});

test('signals and corrections: measured with consent, recalled labeled; declined renders [-] (B3)', () => {
	const sig = (signals, corrections) => ({ plan }) => {
		plan.signals = signals;
		if (corrections) plan.corrections = corrections;
		delete plan.evidence['1.14'];
		delete plan.evidence['3.4'];
	};
	withFixture(sig({ consent: 'yes, read my history', metrics: [{ name: 'repeated corrections', value: '6', window: '14 days', source: '$ jq -s length history.jsonl' }] }, [
		{ text: 'used literal log keys', origin: 'measured', class: 'repeated', tag: 'context: missing', symptom: '6 corrections on log keys', source: '$ jq -s length history.jsonl' },
		{ text: 'wrong test style', origin: 'recalled', class: 'one-off' },
	]), (f) => {
		const g1 = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g1.out, /\[x\] 1\.14 Measured signals: 2 lines below\n {6}consent: "yes, read my history" \(user\); read-only, local only, nothing leaves this machine\n {6}repeated corrections: 6 over 14 days {2}\$ jq/);
		const g3 = run(['--render', 'gate', '--gate', '3', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g3.out, /measured: used literal log keys; repeated; tag context: missing/);
		assert.match(g3.out, /recalled: wrong test style; one-off {2}\(user\)/);
	});
	withFixture(sig({ consent: 'declined' }, []), (f) => {
		const g1 = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g1.out, /\[-\] 1\.14 Measured signals: not applicable: session history declined/);
		const g3 = run(['--render', 'gate', '--gate', '3', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g3.out, /\[x\] 3\.4 Corrections: no corrections: none measured, none recalled/);
	});
	withFixture(sig({ consent: 'ok', metrics: [{ name: 'retries', value: '3', source: '(user)' }] }), (f) => {
		const g1 = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g1.out, /\[ \] 1\.14 /);
	});
	withFixture(sig({ consent: 'ok', metrics: [] }, [{ text: 'x', origin: 'remembered', class: 'one-off' }]), (f) => {
		assert.equal(run(['--render', 'gate', '--gate', '3', '--plan', f.planPath, '--manifest', f.manifestPath]).code, 2);
	});
});

test('evidence with an abridged command, or a short hash anywhere in the plan, fails (A1, A2)', () => {
	withFixture(({ plan }) => (plan.evidence['1.10'] = { mark: 'x', text: '0 values redacted', source: "$ grep -niE '(api_key|token)...' | wc -l" }), (f) => {
		const g1 = run(['--render', 'gate', '--gate', '1', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.match(g1.out, /\[ \] 1\.10 .*abridged command: name the command in full/);
	});
	const short = planCheck(({ plan }) => (plan.proposals[0].answer = 'pinned at sha256:e43d2851, see refresh'));
	assert.equal(short.code, 1);
	assert.match(short.out, /FAIL plan-hashes\n {2}- proposals\[0\]\.answer: short or malformed hash "sha256:e43d2851"/);
	const ellipsis = planCheck(({ plan }) => (plan.report.paste_ready = 'S1 note with prompt c0f82013… pinned'));
	assert.match(ellipsis.out, /- report\.paste_ready: shortened hash/);
});

test('report: every line rendered from record, plan, and manifest; unfilled lines block 6.5 (A5)', () => {
	withFixture(undefined, (f) => {
		const r = run(['--render', 'report', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /^Rerun the checker: download https:\/\/stablekernel\.github\.io\/SHRINE\/shrine-check\.mjs/m);
		assert.match(r.out, /^Top practices: 1\. Run tests before done \(https:\/\/stablekernel\.github\.io\/SHRINE\/patterns\/correction-diagnosis\/\) 2\. Tag repeated corrections/m);
		assert.ok(r.out.trim().split('\n').length <= 15);
	});
	withFixture(({ plan }) => delete plan.report, (f) => {
		showMenus(f);
		const r = run(['--render', 'report', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.equal(r.code, 1);
		assert.match(r.out, /Top practices: <missing: plan\.report\.top_practices>/);
		const fin = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		assert.match(fin.out, /^\[ \] 6\.5 Report: fill plan\.report, then render again: 3 lines not filled/m);
	});
});

test('pin and refresh renders: hashes in full from the manifest; refresh short block (A2)', () => {
	withFixture(undefined, (f) => {
		const pin = run(['--render', 'pin', '--plan', f.planPath, '--manifest', f.manifestPath]);
		assert.equal(pin.code, 0, pin.out);
		assert.match(pin.out, /^commit c0ffee$/m);
		assert.match(pin.out, new RegExp(`^prompt version 11; prompt sha256:${sha('prompt')}$`, 'm'));
		assert.match(pin.out, new RegExp(`^ {2}"Correction Diagnosis" sha256:${PAGES[0].sha256}$`, 'm'));
		const out = outDir();
		try {
			const prompt = join(out, 'prompt.md');
			writeFileSync(prompt, 'prompt');
			const r = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--prompt', prompt, '--out', out]);
			assert.equal(r.code, 0, r.out);
			assert.match(r.out, /^REFRESH: prompt verified$/m);
			assert.match(r.out, /^recorded commit c0ffee, live c0ffee: SHRINE has not moved$/m);
			const s = shortOf(r.out);
			assert.match(readFileSync(s.file, 'utf8'), /fetched prompt .* = manifest prompt\.sha256/);
			const inside = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--out', join(f.root, 'tmp')]);
			assert.equal(inside.code, 2);
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
	});
});

// ---------- the prompt and the checker agree ----------

test('the checker renders exactly the prompt\'s gate items, in order', () => {
	withFixture(undefined, (f) => {
		showMenus(f);
		const { out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		const rendered = [...out.matchAll(/^\[[x -]\] (\d\.\d+) /gm)].map((m) => m[1]);
		assert.deepEqual(rendered, Object.values(ITEMS).flat());
	});
});

test('the checker\'s invariant map equals the prompt\'s Invariant Map', () => {
	const table = PROMPT.split('## Invariant Map')[1].split('## Data Plane')[0];
	const rows = [...table.matchAll(/^\| (\d+ [^|]+?) \| ([^|]+) \|$/gm)].map((m) => [m[1], [...m[2].matchAll(/\b\d\.\d+\b/g)].map((x) => x[0])]);
	assert.equal(rows.length, 13);
	withFixture(undefined, (f) => {
		showMenus(f);
		const { out } = run(['--render', 'final', '--plan', f.planPath, '--manifest', f.manifestPath, '--record', f.recordPath]);
		for (const [name, ids] of rows) {
			const line = out.split('\n').find((l) => l.trim().startsWith(`${name}:`));
			assert.ok(line, `map row ${name}`);
			assert.deepEqual([...line.matchAll(/(\d\.\d+)\[/g)].map((m) => m[1]), ids, name);
		}
	});
});

test('prompt version is 11', () => {
	assert.match(PROMPT, /^Prompt version: 11$/m);
});

test('checker source changes nothing: one write call (new render files only), no spawn or extra network APIs', () => {
	const src = readFileSync(CHECKER, 'utf8');
	for (const api of ['appendFile', 'mkdir', 'rmSync', 'unlink', 'rename', 'copyFile', 'createWriteStream', 'child_process', 'node:http', 'node:net'])
		assert.ok(!src.includes(api), `checker must not use ${api}`);
	assert.equal(src.match(/writeFileSync\(/g).length, 1, 'one write call, for render files');
	assert.match(src, /writeFileSync\(path, text, \{ flag: 'wx' \}\)/, 'the write never overwrites');
	assert.equal(src.match(/fetch\(/g).length, 1, 'one fetch call, for the manifest');
});
