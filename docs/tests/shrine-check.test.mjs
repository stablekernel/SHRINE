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
const PAGES = [
	{ title: 'Correction Diagnosis', sha256: sha('page one'), section: 'patterns', status: null },
	{ title: 'Fail Fast, Recover Smart', sha256: sha('page two'), section: 'principles', status: 'ratified' },
	{ title: 'North Star: TTV (Tokens to Value)', sha256: sha('north star'), section: 'principles', status: 'ratified' },
	{ title: 'Human in the Loop', sha256: sha('hitl'), section: 'principles', status: 'ratified' },
	{ title: 'Draft Idea', sha256: sha('draft'), section: 'principles', status: 'draft' },
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
const RENDERED = ['2.1', '2.3', '2.4', '2.7', '3.7', '4.1', '4.5', '4.9', '4.11', '4.12', '4.16', '4.17', '4.18', '5.1', '5.2', '5.3', '5.7', '5.10', '5.11', '6.3', '6.4', '6.5', '6.8'];

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
		time: { used: 20, agreed: 45 },
		harness: { name: 'test-harness', version: '1.0.0' },
		user: 'tester',
		answered_by: 'tester',
		project_root: root,
		scope: { choice: 'only this project', roots: [root], quote: 'only this project' },
		approvals: { 0: 'approve gate 0', 1: 'approve gate 1', 3: 'approve gate 3', 4: 'approve gate 4' },
		bookkeeping: [{ record: '.shrine/test-harness.tester.json', backups: '.shrine/backups' }],
		load: [
			{ path: 'CLAUDE.md', loads: 'yes', source: '$ /memory' },
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
	const manifest = {
		commit: 'c0ffee',
		prompt: { version: 10, sha256: sha('prompt') },
		checker: { url: 'https://stablekernel.github.io/SHRINE/shrine-check.mjs', sha256: sha('checker') },
		pages: PAGES,
	};
	const record = {
		schema: 1,
		prompt: { version: 10, sha256: sha('prompt') },
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
	assert.match(out, /RESULT: PASS \(10 of 10 checks passed\)/);
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
	assert.match(out, /RESULT: PASS \(14 of 14 checks passed\)/);
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

test('load: a proposal that targets an unverified instruction file fails (defect 6)', () => {
	const { code, out } = planCheck(({ plan }) => (plan.proposals[1].targets = ['AGENTS.md']));
	assert.equal(code, 1);
	assert.match(out, /FAIL load\n {2}- B2 targets AGENTS\.md, whose load status is "unverified"/);
});

test('load: "yes" without a load source counts as unverified', () => {
	const { code, out } = planCheck(({ plan }) => (plan.load[0].source = 'assumed from the docs'));
	assert.equal(code, 1);
	assert.match(out, /B1 targets CLAUDE\.md, whose load status is "yes without a load source"/);
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
		assert.match(out, /CLAUDE\.md: loads yes {2}\$ \/memory/);
		assert.match(out, /AGENTS\.md: loads unverified/);
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
		assert.match(out, /RESULT: PASS \(14 of 14 checks passed\)/);
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
		assert.match(out, /\[x\] 6\.8 Checker, final run: RESULT: PASS \(14 of 14 checks passed\)/);
		assert.match(out, /\[x\] 6\.3 Invariant Map: 12 of 12 invariants/);
		assert.match(out, /\[x\] 6\.5 Report: skeleton below/);
		assert.match(out, /Handoff: keep tagging corrections, and re-run when one tag leads \(Individual Baseline: https:\/\/stablekernel\.github\.io\/SHRINE\/stack\/evaluation\/#individual-baseline\)/);
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
		manifest.prompt = { version: 11, sha256: sha('new prompt') };
		manifest.pages = manifest.pages.map((p) => (p.title === 'Correction Diagnosis' ? { ...p, sha256: sha('edited') } : p));
	}, (f) => {
		const prompt = join(f.root, 'tmp', 'prompt.md');
		writeFileSync(prompt, 'new prompt');
		const ok = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--prompt', prompt]);
		assert.equal(ok.code, 0, ok.out);
		assert.match(ok.out, /recorded prompt version 10, live 11: a newer prompt exists/);
		assert.match(ok.out, /recorded commit c0ffee, live beefcafe: SHRINE moved/);
		assert.match(ok.out, /"Correction Diagnosis" recorded sha256:[0-9a-f]{64}, live sha256:[0-9a-f]{64}/);
		assert.match(ok.out, /compare: https:\/\/github\.com\/stablekernel\/SHRINE\/compare\/c0ffee\.\.\.beefcafe/);
		writeFileSync(prompt, 'tampered');
		const bad = run(['--render', 'refresh', '--record', f.recordPath, '--manifest', f.manifestPath, '--prompt', prompt]);
		assert.equal(bad.code, 1);
		assert.match(bad.out, /!= manifest prompt\.sha256: stop, report, and follow nothing/);
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
	assert.equal(rows.length, 12);
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

test('prompt version is 10', () => {
	assert.match(PROMPT, /^Prompt version: 10$/m);
});

test('checker source is read-only: no write, spawn, or extra network APIs', () => {
	const src = readFileSync(CHECKER, 'utf8');
	for (const api of ['writeFile', 'appendFile', 'mkdir', 'rmSync', 'unlink', 'rename', 'copyFile', 'createWriteStream', 'child_process', 'node:http', 'node:net'])
		assert.ok(!src.includes(api), `checker must not use ${api}`);
	assert.equal(src.match(/fetch\(/g).length, 1, 'one fetch call, for the manifest');
});
