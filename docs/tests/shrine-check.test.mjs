// Tests for src/tools/shrine-check.mjs. Run: npm test (Node built-in runner, no dependencies).
// Each test builds a fixture scope root in a temp folder: files, backups, a manifest, and a record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKER = fileURLToPath(new URL('../src/tools/shrine-check.mjs', import.meta.url));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const MADE_UP = 'ab'.repeat(32);

const ORIGINAL = '# Project rules\n';
const AFTER_B1 = `${ORIGINAL}<!-- shrine:B1 -->\nRun tests before done.\n`;
const AFTER_B2 = `${AFTER_B1}<!-- shrine:B2 -->\nCite the failing test.\n`;
const NEW_FILE = '<!-- shrine:S2 -->\nSHRINE staleness check\n';
const PAGES = [
	{ title: 'Correction Diagnosis', sha256: sha('page one') },
	{ title: 'Fail Fast, Recover Smart', sha256: sha('page two') },
];

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

function fixture(mutate = () => {}) {
	const root = mkdtempSync(join(tmpdir(), 'shrine-check-'));
	mkdirSync(join(root, '.shrine', 'backups'), { recursive: true });
	writeFileSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1'), ORIGINAL);
	writeFileSync(join(root, 'CLAUDE.md'), AFTER_B2);
	writeFileSync(join(root, 'stale.md'), NEW_FILE);
	const manifest = { commit: 'c0ffee', prompt: { version: 9, sha256: sha('prompt') }, pages: PAGES };
	writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
	const record = {
		schema: 1,
		prompt: { version: 9, sha256: sha('prompt') },
		commit: 'c0ffee',
		harness: { name: 'test-harness', version: '1.0.0' },
		user: 'tester',
		answered_by: 'tester',
		answers: { scope: 'this project' },
		pages: PAGES.map((p) => ({ ...p })),
		entries: [
			entry({ id: 'B1', before_sha256: sha(ORIGINAL), after_sha256: sha(AFTER_B1), backup: '.shrine/backups/CLAUDE.md.1' }),
			entry({ id: 'B2', before_sha256: sha(AFTER_B1), after_sha256: sha(AFTER_B2) }),
			entry({ id: 'S2', target: 'stale.md', scope: 'in place', after_sha256: sha(NEW_FILE), page_sha256: PAGES[1].sha256 }),
			entry({ id: 'C1', target: 'other.md', scope: 'reject', status: 'rejected' }),
		],
	};
	mutate(record, root);
	const recordPath = join(root, '.shrine', 'test-harness.tester.json');
	writeFileSync(recordPath, JSON.stringify(record, null, 2));
	return { root, recordPath, manifestPath: join(root, 'manifest.json') };
}

function run(args) {
	const res = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' });
	return { code: res.status, out: res.stdout + res.stderr };
}

function check(mutate, extra = ['--post-apply']) {
	const f = fixture(mutate);
	try {
		return run(['--record', f.recordPath, '--manifest', f.manifestPath, ...extra]);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
}

test('valid record passes every check with full hashes', () => {
	const { code, out } = check();
	assert.equal(code, 0, out);
	assert.match(out, /RESULT: PASS \(10 of 10 checks passed\)/);
	assert.match(out, /PASS counts: pending 0; done 3 \(B1, B2, S2\); rejected 1 \(C1\)/);
	assert.match(out, new RegExp(`sha256:${sha(AFTER_B2)}`));
	assert.doesNotMatch(out, /FAIL/);
});

test('mismatched page hash fails page-hashes', () => {
	const { code, out } = check((r) => (r.pages[0].sha256 = sha('edited page')));
	assert.equal(code, 1);
	assert.match(out, /FAIL page-hashes\n {2}- "Correction Diagnosis" record sha256:[0-9a-f]{64} != manifest sha256:[0-9a-f]{64}/);
});

test('made-up page hash in an entry fails page-hashes', () => {
	const { code, out } = check((r) => (r.entries[0].page_sha256 = MADE_UP));
	assert.equal(code, 1);
	assert.match(out, new RegExp(`B1.page_sha256 sha256:${MADE_UP} matches no manifest page`));
});

test('made-up after hash fails targets as drift', () => {
	const { code, out } = check((r) => (r.entries[1].after_sha256 = MADE_UP));
	assert.equal(code, 1);
	assert.match(out, /FAIL targets\n {2}- drift: .*CLAUDE\.md current sha256:[0-9a-f]{64} != B2\.after/);
});

test('shortened hash fails hash-format', () => {
	const { code, out } = check((r) => (r.pages[1].sha256 = PAGES[1].sha256.slice(0, 16)));
	assert.equal(code, 1);
	assert.match(out, /FAIL hash-format\n {2}- pages\[1\] Fail Fast, Recover Smart "[0-9a-f]{16}" is not 64 lowercase hex/);
});

test('broken hash chain fails hash-chain', () => {
	const { code, out } = check((r) => (r.entries[1].before_sha256 = sha(ORIGINAL)));
	assert.equal(code, 1);
	assert.match(out, /FAIL hash-chain\n {2}- B2\.before sha256:[0-9a-f]{64} != B1\.after/);
});

test('missing backup fails backups', () => {
	const { code, out } = check((r, root) => rmSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1')));
	assert.equal(code, 1);
	assert.match(out, /FAIL backups\n {2}- B1: backup .*CLAUDE\.md\.1 missing/);
});

test('backup with wrong content fails backups', () => {
	const { code, out } = check((r, root) => writeFileSync(join(root, '.shrine', 'backups', 'CLAUDE.md.1'), 'changed'));
	assert.equal(code, 1);
	assert.match(out, /B1: backup .* sha256:[0-9a-f]{64} != before sha256:[0-9a-f]{64}/);
});

test('pending entry fails no-pending with --post-apply only', () => {
	const pend = (r, root) => {
		r.entries[1].status = 'pending';
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
	const { code, out } = check((r) => (r.entries[0].scope = 'approve'));
	assert.equal(code, 1);
	assert.match(out, /FAIL blast-radius\n {2}- B1\.scope "approve" not one of: in place, locally only, reviewable change, reject/);
});

test('missing required field fails shape', () => {
	const { code, out } = check((r) => {
		delete r.harness;
		delete r.entries[0].ack;
	});
	assert.equal(code, 1);
	assert.match(out, /FAIL shape\n {2}- harness\.name and harness\.version required\n {2}- B1\.ack required/);
});

test('record from another commit fails pin', () => {
	const { code, out } = check((r) => (r.commit = 'deadbeef'));
	assert.equal(code, 1);
	assert.match(out, /FAIL pin\n {2}- record commit deadbeef != manifest commit c0ffee/);
});

test('uninstall mode: record absent and kept backups verified', () => {
	const f = fixture();
	try {
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
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test('usage error exits 2', () => {
	assert.equal(run([]).code, 2);
	assert.equal(run(['--record', 'x.json', '--manifest', 'http://example.com/m.json']).code, 2);
});

test('checker source is read-only: no write, spawn, or extra network APIs', () => {
	const src = readFileSync(CHECKER, 'utf8');
	for (const api of ['writeFile', 'appendFile', 'mkdir', 'rmSync', 'unlink', 'rename', 'copyFile', 'createWriteStream', 'child_process', 'node:http', 'node:net'])
		assert.ok(!src.includes(api), `checker must not use ${api}`);
	assert.equal(src.match(/fetch\(/g).length, 1, 'one fetch call, for the manifest');
});
