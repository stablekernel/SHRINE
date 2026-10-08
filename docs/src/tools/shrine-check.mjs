#!/usr/bin/env node
// SHRINE checker: validates a SHRINE install record against the manifest and the files it names.
// Served at https://stablekernel.github.io/SHRINE/shrine-check.mjs; its sha256 is in the manifest.
//
// Read-only. It reads the record, the files and backups the record names, and the manifest.
// It writes nothing anywhere, starts no process, and makes no network call other than
// fetching the manifest URL it is given. Zero dependencies; Node 18 or later.
//
// Usage:
//   node shrine-check.mjs --record <path> --manifest <https URL | file> [--post-apply]
//   node shrine-check.mjs --uninstall --record <path> --record-backup <path> [--backups-deleted]
//
// Exit: 0 every check PASS, 1 any check FAIL, 2 usage or input error.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

const VERSION = 1;
const PICKS = ['in place', 'locally only', 'reviewable change', 'reject'];
const STATUSES = ['pending', 'done', 'rejected'];
const HEX64 = /^[0-9a-f]{64}$/;
const ENTRY_STRINGS = ['id', 'target', 'scope', 'ack', 'marker', 'status', 'teaching', 'undo'];
const ENTRY_NULLABLE = ['before_sha256', 'after_sha256', 'backup', 'page_sha256'];

const USAGE = `usage:
  node shrine-check.mjs --record <path> --manifest <https URL | file> [--post-apply]
  node shrine-check.mjs --uninstall --record <path> --record-backup <path> [--backups-deleted]`;

function parseArgs(argv) {
	const opts = { postApply: false, uninstall: false, backupsDeleted: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--post-apply') opts.postApply = true;
		else if (a === '--uninstall') opts.uninstall = true;
		else if (a === '--backups-deleted') opts.backupsDeleted = true;
		else if (a === '--record' || a === '--manifest' || a === '--record-backup') {
			const v = argv[++i];
			if (!v) throw new Error(`${a} needs a value`);
			opts[a.slice(2).replace('-b', 'B')] = v;
		} else throw new Error(`unknown argument: ${a}`);
	}
	if (!opts.record) throw new Error('--record is required');
	if (opts.uninstall && !opts.recordBackup) throw new Error('--uninstall needs --record-backup');
	if (!opts.uninstall && !opts.manifest) throw new Error('--manifest is required');
	return opts;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const h = (hex) => (hex == null ? 'absent' : `sha256:${hex}`);

function fileSha(path) {
	try {
		return statSync(path).isFile() ? sha(readFileSync(path)) : null;
	} catch {
		return null;
	}
}

function exists(path) {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

// Record paths are absolute, `~/`-prefixed, or relative to the scope root (the folder that holds `.shrine/`).
function resolver(recordPath) {
	const root = dirname(dirname(resolve(recordPath)));
	return (p) => {
		if (p === '~' || p.startsWith('~/')) return resolve(homedir(), p.slice(2));
		return isAbsolute(p) ? p : resolve(root, p);
	};
}

async function loadManifest(src) {
	let text;
	if (/^https:\/\//.test(src)) {
		const res = await fetch(src);
		if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
		text = Buffer.from(await res.arrayBuffer());
	} else if (/^[a-z]+:\/\//i.test(src)) {
		throw new Error('manifest URL must be https');
	} else {
		text = readFileSync(src);
	}
	return { hash: sha(text), data: JSON.parse(text.toString('utf8')) };
}

function loadRecord(path) {
	const buf = readFileSync(path);
	return { hash: sha(buf), data: JSON.parse(buf.toString('utf8')) };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

function shapeErrors(r) {
	const errs = [];
	if (!isObj(r)) return ['record is not a JSON object'];
	if (r.schema !== 1) errs.push('schema must be 1');
	if (!isObj(r.prompt) || !Number.isInteger(r.prompt.version) || typeof r.prompt.sha256 !== 'string')
		errs.push('prompt.version (integer) and prompt.sha256 (string) required');
	if (!isStr(r.commit)) errs.push('commit required');
	if (!isObj(r.harness) || !isStr(r.harness.name) || !isStr(r.harness.version))
		errs.push('harness.name and harness.version required');
	if (!isStr(r.user)) errs.push('user required');
	if (!isStr(r.answered_by)) errs.push('answered_by required');
	if (!isObj(r.answers)) errs.push('answers (object) required');
	if (!Array.isArray(r.pages)) errs.push('pages (array) required');
	else
		r.pages.forEach((p, i) => {
			if (!isObj(p) || !isStr(p.title) || typeof p.sha256 !== 'string') errs.push(`pages[${i}] needs title and sha256`);
		});
	if (!Array.isArray(r.entries)) errs.push('entries (array) required');
	else
		r.entries.forEach((e, i) => {
			if (!isObj(e)) return errs.push(`entries[${i}] is not an object`);
			const name = isStr(e.id) ? e.id : `entries[${i}]`;
			for (const k of ENTRY_STRINGS) if (!isStr(e[k])) errs.push(`${name}.${k} required`);
			for (const k of ENTRY_NULLABLE)
				if (!(k in e) || (e[k] !== null && typeof e[k] !== 'string')) errs.push(`${name}.${k} required (string or null)`);
			if (isStr(e.status) && !STATUSES.includes(e.status)) errs.push(`${name}.status "${e.status}" not one of ${STATUSES.join(', ')}`);
		});
	return errs;
}

// Every entry list check skips malformed entries; the shape check already reports them.
const goodEntries = (r) => (Array.isArray(r.entries) ? r.entries.filter((e) => isObj(e) && isStr(e.id) && isStr(e.target)) : []);
const applied = (e) => e.status !== 'rejected';

function byTarget(entries, resolvePath) {
	const map = new Map();
	for (const e of entries.filter(applied)) {
		const key = resolvePath(e.target);
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(e);
	}
	return map;
}

function hashFormat(r) {
	const bad = [];
	const test = (label, v) => {
		if (v != null && !HEX64.test(v)) bad.push(`${label} "${v}" is not 64 lowercase hex`);
	};
	if (isObj(r.prompt)) test('prompt.sha256', r.prompt.sha256);
	if (Array.isArray(r.pages)) r.pages.forEach((p, i) => isObj(p) && test(`pages[${i}] ${p.title}`, p.sha256));
	for (const e of goodEntries(r)) for (const k of ['before_sha256', 'after_sha256', 'page_sha256']) test(`${e.id}.${k}`, e[k]);
	return bad;
}

class Report {
	constructor() {
		this.lines = [];
		this.failed = 0;
		this.total = 0;
	}
	info(line) {
		this.lines.push(line);
	}
	check(name, problems, passDetail) {
		this.total++;
		if (problems.length) {
			this.failed++;
			this.lines.push(`FAIL ${name}`);
			for (const p of problems) this.lines.push(`  - ${p}`);
		} else this.lines.push(`PASS ${name}: ${passDetail}`);
	}
}

function installChecks(rep, rec, man, opts) {
	const r = rec.data;
	const m = man.data;
	const resolvePath = resolver(opts.record);
	const shape = shapeErrors(r);
	const entries = goodEntries(r);
	rep.check('shape', shape, `required fields present; ${entries.length} entries: ${entries.map((e) => e.id).join(', ') || 'none'}`);
	if (!isObj(r)) return;

	rep.check('hash-format', hashFormat(r), 'every hash is 64 lowercase hex');

	const pin = [];
	if (r.commit !== m.commit) pin.push(`record commit ${r.commit} != manifest commit ${m.commit}`);
	const rp = isObj(r.prompt) ? r.prompt.sha256 : undefined;
	const mp = isObj(m.prompt) ? m.prompt.sha256 : undefined;
	if (rp !== mp) pin.push(`record prompt ${h(rp)} != manifest prompt ${h(mp)}`);
	rep.check('pin', pin, `commit ${m.commit}; prompt ${h(mp)}`);

	const mpages = new Map((Array.isArray(m.pages) ? m.pages : []).map((p) => [p.title, p.sha256]));
	const mhashes = new Set(mpages.values());
	const pages = [];
	const pageLines = [];
	for (const p of Array.isArray(r.pages) ? r.pages.filter(isObj) : []) {
		if (!mpages.has(p.title)) pages.push(`"${p.title}" not in manifest`);
		else if (mpages.get(p.title) !== p.sha256)
			pages.push(`"${p.title}" record ${h(p.sha256)} != manifest ${h(mpages.get(p.title))}`);
		else pageLines.push(`  "${p.title}" ${h(p.sha256)}`);
	}
	for (const e of entries)
		if (e.page_sha256 != null && !mhashes.has(e.page_sha256)) pages.push(`${e.id}.page_sha256 ${h(e.page_sha256)} matches no manifest page`);
	rep.check('page-hashes', pages, `${pageLines.length} pages equal the manifest`);
	if (!pages.length) pageLines.forEach((l) => rep.info(l));

	const scope = [];
	for (const e of entries) {
		if (!PICKS.includes(e.scope)) scope.push(`${e.id}.scope "${e.scope}" not one of: ${PICKS.join(', ')}`);
		else if ((e.scope === 'reject') !== (e.status === 'rejected'))
			scope.push(`${e.id}: scope "reject" and status "rejected" must go together`);
	}
	rep.check('blast-radius', scope, `${entries.length} entries each picked one of: ${PICKS.join(', ')}`);

	const groups = byTarget(entries, resolvePath);
	const chain = [];
	for (const [target, list] of groups)
		for (let i = 1; i < list.length; i++) {
			const prev = list[i - 1];
			if (prev.status !== 'done') chain.push(`${list[i].id} follows ${prev.id}, which is ${prev.status}, on ${target}`);
			else if (list[i].before_sha256 !== prev.after_sha256)
				chain.push(`${list[i].id}.before ${h(list[i].before_sha256)} != ${prev.id}.after ${h(prev.after_sha256)} on ${target}`);
		}
	rep.check('hash-chain', chain, `${groups.size} targets, each before equals the previous after`);

	const backups = [];
	const backupLines = [];
	for (const [target, list] of groups)
		if (list[0].before_sha256 != null && list[0].backup == null) backups.push(`${list[0].id}: first change to ${target} has no backup`);
	for (const e of entries.filter(applied)) {
		if (e.backup == null) continue;
		const path = resolvePath(e.backup);
		const actual = fileSha(path);
		if (actual == null) backups.push(`${e.id}: backup ${path} missing`);
		else if (actual !== e.before_sha256) backups.push(`${e.id}: backup ${path} ${h(actual)} != before ${h(e.before_sha256)}`);
		else backupLines.push(`  ${e.id} ${path} ${h(actual)}`);
	}
	rep.check('backups', backups, `${backupLines.length} backups present and equal their before hash`);
	if (!backups.length) backupLines.forEach((l) => rep.info(l));

	const drift = [];
	const targetLines = [];
	for (const [target, list] of groups) {
		const last = list[list.length - 1];
		const actual = fileSha(target);
		if (last.status !== 'done') targetLines.push(`  ${target} ${h(actual)} (last entry ${last.id} is ${last.status})`);
		else if (actual !== last.after_sha256)
			drift.push(`drift: ${target} current ${h(actual)} != ${last.id}.after ${h(last.after_sha256)}`);
		else targetLines.push(`  ${target} ${h(actual)} = ${last.id}.after`);
	}
	rep.check('targets', drift, `${groups.size} targets match their last after hash`);
	if (!drift.length) targetLines.forEach((l) => rep.info(l));

	const counts = STATUSES.map((s) => {
		const ids = entries.filter((e) => e.status === s).map((e) => e.id);
		return `${s} ${ids.length}${ids.length ? ` (${ids.join(', ')})` : ''}`;
	});
	rep.check('counts', [], counts.join('; '));

	if (opts.postApply) {
		const pending = entries.filter((e) => e.status === 'pending').map((e) => e.id);
		rep.check('no-pending', pending.length ? [`${pending.length} pending: ${pending.join(', ')}`] : [], '0 pending');
	}
}

function uninstallChecks(rep, opts) {
	const record = resolve(opts.record);
	const base = record.replace(/\.json$/, '');
	const left = [record, `${base}.pointer`, `${base}.trust`].filter(exists);
	rep.check('record-absent', left.map((p) => `still present: ${p}`), `${record} and its pointer and trust files are absent`);

	let rec;
	try {
		rec = loadRecord(opts.recordBackup);
	} catch (err) {
		rep.check('record-backup', [`cannot read ${opts.recordBackup}: ${err.message}`], '');
		return;
	}
	rep.info(`record backup: ${resolve(opts.recordBackup)} ${h(rec.hash)}`);
	const shape = shapeErrors(rec.data);
	rep.check('record-backup', shape, 'readable, required fields present');
	if (!isObj(rec.data)) return;

	// Backup paths resolve against the original record's scope root.
	const resolvePath = resolver(opts.record);
	const problems = [];
	const lines = [];
	for (const e of goodEntries(rec.data).filter(applied)) {
		if (e.backup == null) continue;
		const path = resolvePath(e.backup);
		const actual = fileSha(path);
		if (opts.backupsDeleted) {
			if (actual != null) problems.push(`${e.id}: backup ${path} still present after approved deletion`);
			else lines.push(`  ${e.id} ${path} absent (deleted)`);
		} else if (actual == null) problems.push(`${e.id}: kept backup ${path} missing`);
		else if (actual !== e.before_sha256) problems.push(`${e.id}: kept backup ${path} ${h(actual)} != before ${h(e.before_sha256)}`);
		else lines.push(`  ${e.id} ${path} ${h(actual)}`);
	}
	rep.check('backups', problems, opts.backupsDeleted ? `${lines.length} backups deleted` : `${lines.length} kept backups equal their before hash`);
	if (!problems.length) lines.forEach((l) => rep.info(l));
}

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`shrine-check: ${err.message}\n${USAGE}`);
		return 2;
	}
	const rep = new Report();
	rep.info(`shrine-check ${VERSION} (read-only) mode: ${opts.uninstall ? 'uninstall' : opts.postApply ? 'post-apply' : 'check'}`);
	if (opts.uninstall) uninstallChecks(rep, opts);
	else {
		let rec;
		let man;
		try {
			man = await loadManifest(opts.manifest);
			rec = loadRecord(opts.record);
		} catch (err) {
			console.error(`shrine-check: ${err.message}`);
			return 2;
		}
		rep.info(`record: ${resolve(opts.record)} ${h(rec.hash)}`);
		rep.info(`manifest: ${opts.manifest} ${h(man.hash)}`);
		installChecks(rep, rec, man, opts);
	}
	rep.info(`RESULT: ${rep.failed ? 'FAIL' : 'PASS'} (${rep.total - rep.failed} of ${rep.total} checks passed)`);
	console.log(rep.lines.join('\n'));
	return rep.failed ? 1 : 0;
}

process.exitCode = await main();
