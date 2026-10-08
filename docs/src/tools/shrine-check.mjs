#!/usr/bin/env node
// SHRINE checker: validates a SHRINE install record and plan, and renders the rigid parts of
// the install prompt's output (gates, pick menus, Final Gate, report skeleton) from them.
// Served at https://stablekernel.github.io/SHRINE/shrine-check.mjs; its sha256 is in the manifest.
//
// It reads the record, the plan, the files and backups they name, and the manifest. It changes
// no file. Its one write: with --out <dir>, a render goes to a new file in that folder (never
// an existing file, and never inside a scope root), and it prints a short block instead.
// It starts no process and makes no network call other than fetching the manifest URL it is
// given. Zero dependencies; Node 18 or later.
//
// Usage:
//   node shrine-check.mjs --record <path> --manifest <https URL | file> [--plan <path>] [--post-apply]
//   node shrine-check.mjs --uninstall --record <path> --record-backup <path> [--plan <path>] [--backups-deleted]
//   node shrine-check.mjs --render <kind> --plan <path> [--gate <0-5>] [--manifest <src>] [--record <path>]
//       [--uninstall --record-backup <path> [--backups-deleted]] [--prompt <file>] [--out <dir>]
//   kinds: menus, gate, coverage, final, report, pin, refresh (refresh needs --record and --manifest only)
//
// Exit: 0 every check PASS (a render that is PASS or WAITING FOR APPROVAL), 1 any FAIL or a
// BLOCKED render, 2 usage or input error.
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 4;
const PICKS = ['in place', 'locally only', 'reviewable change', 'reject'];
const OPTIONS = PICKS.slice(0, 3);
const STATUSES = ['pending', 'done', 'rejected'];
const COVERAGE = ['applied', 'advised', 'not relevant'];
const DECISIONS = ['approved', 'edited and approved', 'rejected'];
const RUNS = ['install', 're-run', 'uninstall'];
const MODES = ['full', 'paste-ready', 'report-only'];
const LOADS = ['yes', 'no', 'unverified'];
const DELIVERY = ['file', 'inline'];
const RISKS = ['local text', 'shared', 'code'];
// Minimum independent reviewers per risk class (Adversarial Review, Multi-Model Consensus).
const MIN_REVIEWERS = { 'local text': 1, shared: 2, code: 2 };
const ORIGINS = ['measured', 'recalled'];
const INDEX_TITLE = 'Anti-patterns';
const HEX64 = /^[0-9a-f]{64}$/;
const SOURCE = /^(\$ \S.*|\(user\)|\(plan\)|\(probe: \S.*\))$/;
const LOAD_SOURCE = /^(\$ \S.*|\(user\)|\(probe: \S.*\))$/;
const TOOL_SOURCE = /^(\$ \S.*|\(probe: \S.*\))$/;
const ENTRY_STRINGS = ['id', 'target', 'scope', 'ack', 'marker', 'status', 'teaching', 'undo'];
const ENTRY_NULLABLE = ['before_sha256', 'after_sha256', 'backup', 'page_sha256'];
const SITE = 'https://stablekernel.github.io/SHRINE/';
const RENDERS = ['menus', 'gate', 'coverage', 'final', 'report', 'pin', 'refresh'];

const USAGE = `usage:
  node shrine-check.mjs --record <path> --manifest <https URL | file> [--plan <path>] [--post-apply]
  node shrine-check.mjs --uninstall --record <path> --record-backup <path> [--plan <path>] [--backups-deleted]
  node shrine-check.mjs --render <menus|gate|coverage|final|report|pin|refresh> --plan <path> [--gate <0-5>]
      [--manifest <src>] [--record <path>] [--uninstall --record-backup <path>] [--prompt <file>] [--out <dir>]`;

// ---------- gate catalog: item ids and titles, in the prompt's order ----------

// `user`: the item needs a user reply, so it prints `[-] not applicable: report-only` in report-only mode.
const GATES = [
	{ n: 0, name: 'Start', approval: true, next: 'Phase 1: Discover the Environment', items: [
		['0.1', 'Harness name and version'], ['0.2', 'Can pause'], ['0.3', 'Mode, delivery, and models'],
		['0.4', 'Time box agreed', 'user'], ['0.5', 'Run type', 'user'], ['0.6', 'Records found'],
		['0.7', 'Checker', 'user'] ] },
	{ n: 1, name: 'Discover the Environment', approval: true, next: 'Phase 2: Pin SHRINE', items: [
		['1.1', 'Instruction files that load, per scope, and load order'], ['1.2', 'Higher layers'],
		['1.3', 'Extension points'], ['1.4', 'Committed or shared versus local'], ['1.5', 'Capabilities'],
		['1.6', 'Existing content'], ['1.7', 'Prior records'],
		['1.8', 'Pending or stale entries'], ['1.9', 'Red-flag scan'], ['1.10', 'No secret printed'],
		['1.11', 'User corrected or confirmed the inventory', 'user'], ['1.12', 'Snapshot'],
		['1.13', 'Anti-pattern scan'], ['1.14', 'Measured signals', 'user'] ] },
	{ n: 2, name: 'Pin SHRINE', approval: false, next: 'Phase 3: Interview and Tag', items: [
		['2.1', 'Manifest'], ['2.2', 'Fetch route'], ['2.3', 'Correction Diagnosis'], ['2.4', 'Fail Fast, Recover Smart'],
		['2.5', 'Red-flag scan of fetched pages'], ['2.6', 'Re-run changes'], ['2.7', 'Principles list'] ] },
	{ n: 3, name: 'Interview and Tag', approval: true, next: 'Phase 4: Design and Approve', items: [
		['3.1', 'Questions asked'], ['3.2', 'Who answered'], ['3.3', 'Answers'], ['3.4', 'Corrections'],
		['3.5', 'User confirmed the classes and tags', 'user'], ['3.6', 'Must-not-change list'], ['3.7', 'Scope roots'] ] },
	{ n: 4, name: 'Design and Approve', approval: true, next: 'Phase 5: Apply', items: [
		['4.1', 'Pages read'], ['4.2', 'Bookkeeping location per scope'], ['4.3', 'Bookkeeping approved first', 'user'],
		['4.4', 'Record commit decision', 'user'], ['4.5', 'Every proposal traces to a page and a user answer'],
		['4.6', 'Always-loaded lines name their miss'], ['4.7', 'Higher layers not weakened'],
		['4.8', 'Code-running proposals', 'user'], ['4.9', 'Blast radius and pick menus', 'user'], ['4.10', 'Prunes', 'user'],
		['4.11', 'Coverage'], ['4.12', 'Decision per proposal', 'user'], ['4.13', 'No secret in any diff'],
		['4.14', 'Entries from 1.8', 'user'], ['4.15', 'Nothing written in Phase 4'], ['4.16', 'Trade-off per proposal'],
		['4.17', 'S1 refresh entry', 'user'], ['4.18', 'S2 staleness check', 'user'],
		['4.19', 'Model fit and adversarial review'], ['4.20', 'Scan findings resolved'], ['4.21', 'Nudges'],
		['4.22', 'Baseline practices', 'user'] ] },
	{ n: 5, name: 'Apply', approval: false, next: 'Phase 6: Verify, Self-Audit, Hand Off', items: [
		['5.1', 'Record written per scope'], ['5.2', 'Backups'], ['5.3', 'Each change'], ['5.4', 'Applied text matches approved text'],
		['5.5', 'Each change landed at its chosen scope'], ['5.6', 'Backups not committed'], ['5.7', 'No pending entries left'],
		['5.8', 'Nothing changed outside approved targets'], ['5.9', 'Every write cites an approved id'],
		['5.10', 'Page hashes in the record'], ['5.11', 'Checker, post-apply'] ] },
];
const FINAL_ITEMS = [
	['6.1', 'Changes load'], ['6.2', 'Self-audit'], ['6.3', 'Invariant Map'], ['6.4', 'Restore instructions'],
	['6.5', 'Report'], ['6.6', 'Record removal'], ['6.7', 'Backup deletion'], ['6.8', 'Checker, final run'],
];
const UNINSTALL_GATE4 = ['4.2', '4.3', '4.8', '4.9', '4.12', '4.13', '4.15'];
const REMOVED_ON_UNINSTALL = ['5.1', '5.2', '5.10', '5.11'];

// Invariant -> enforcing items. Keep equal to the prompt's Invariant Map (a test compares them).
const INVARIANTS = [
	['1 Approval', ['0.4', '0.5', '0.7', '1.11', '1.14', '3.5', '4.3', '4.9', '4.12', '4.14', '4.15', '4.17', '4.18', '5.4', '5.9', '6.6', '6.7']],
	['2 Code that runs', ['0.7', '1.3', '4.8', '4.9', '4.19', '4.21']],
	['3 Reversible', ['1.8', '1.12', '4.2', '4.15', '5.1', '5.2', '5.3', '5.6', '5.7', '5.8', '5.11', '6.2', '6.4', '6.7', '6.8']],
	['4 Record', ['0.6', '1.7', '1.8', '4.2', '4.14', '5.1', '5.3', '5.10', '5.11', '6.4', '6.6', '6.8']],
	['5 Traceable', ['2.3', '2.4', '2.7', '4.1', '4.5', '4.11', '4.20', '5.10', '5.11']],
	['6 Content is data', ['0.7', '1.9', '2.5', '4.17']],
	['7 Secrets', ['1.10', '1.14', '4.13']],
	['8 Narrow', ['3.7', '4.2', '4.6', '4.7', '4.10', '4.16', '4.18', '4.21', '5.8']],
	['9 Bounded', ['0.4']],
	['10 Cannot pause', ['0.2', '0.3']],
	['11 Blast radius', ['1.4', '3.7', '4.2', '4.4', '4.9', '5.5', '5.6', '5.11']],
	['12 Evidence from tools', ['0.7', '1.1', '1.13', '1.14', '5.10', '5.11', '6.1', '6.2', '6.8']],
	['13 Practise SHRINE', ['1.13', '1.14', '4.11', '4.19', '4.20', '4.21', '4.22', '6.1']],
];

// ---------- input ----------

function parseArgs(argv) {
	const opts = { postApply: false, uninstall: false, backupsDeleted: false };
	const valued = { '--record': 'record', '--manifest': 'manifest', '--record-backup': 'recordBackup', '--plan': 'plan', '--render': 'render', '--gate': 'gate', '--prompt': 'prompt', '--out': 'out' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--post-apply') opts.postApply = true;
		else if (a === '--uninstall') opts.uninstall = true;
		else if (a === '--backups-deleted') opts.backupsDeleted = true;
		else if (a in valued) {
			const v = argv[++i];
			if (!v) throw new Error(`${a} needs a value`);
			opts[valued[a]] = v;
		} else throw new Error(`unknown argument: ${a}`);
	}
	if (opts.uninstall && !opts.recordBackup) throw new Error('--uninstall needs --record-backup');
	if (opts.uninstall && opts.record) {
		const r = resolve(expandHome(opts.record));
		if (r === resolve(expandHome(opts.recordBackup)) || /[\\/]\.shrine[\\/]backups[\\/]/.test(r))
			throw new Error('--record is the record\'s own path, not its backup: pass the path the record had, and its backup as --record-backup');
	}
	if (opts.out && !opts.render) throw new Error('--out works only with --render');
	if (opts.render) {
		if (!RENDERS.includes(opts.render)) throw new Error(`--render must be one of: ${RENDERS.join(', ')}`);
		if (opts.render === 'refresh') {
			if (!opts.record || !opts.manifest) throw new Error('--render refresh needs --record and --manifest');
			return opts;
		}
		if (!opts.plan) throw new Error(`--render ${opts.render} needs --plan`);
		if (opts.render === 'gate') {
			if (!/^[0-5]$/.test(opts.gate ?? '')) throw new Error('--render gate needs --gate 0 to 5');
			opts.gate = Number(opts.gate);
			if (opts.gate === 5 && opts.record && !opts.manifest) throw new Error('--render gate --gate 5 --record needs --manifest');
		}
		if ((opts.render === 'coverage' || opts.render === 'pin') && !opts.manifest) throw new Error(`--render ${opts.render} needs --manifest`);
		if (opts.render === 'final' && opts.uninstall && !opts.record) throw new Error('--render final --uninstall needs --record');
		if (opts.render === 'final' && opts.record && !opts.uninstall && !opts.manifest) throw new Error('--render final --record needs --manifest');
		if (opts.render === 'report' && !opts.record) throw new Error('--render report needs --record');
		return opts;
	}
	if (!opts.record) throw new Error('--record is required');
	if (!opts.uninstall && !opts.manifest) throw new Error('--manifest is required');
	return opts;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const h = (hex) => (hex == null ? 'absent' : `sha256:${hex}`);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

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

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);

// Record paths are absolute, `~/`-prefixed, or relative to the scope root (the folder that holds `.shrine/`).
function resolver(recordPath) {
	const root = dirname(dirname(resolve(recordPath)));
	return (p) => {
		const e = expandHome(p);
		return isAbsolute(e) ? e : resolve(root, e);
	};
}

// Plan paths are absolute, `~/`-prefixed, or relative to the plan's project_root.
function planResolver(plan) {
	const root = isStr(plan?.project_root) ? resolve(expandHome(plan.project_root)) : null;
	return (p) => {
		const e = expandHome(p);
		if (isAbsolute(e)) return e;
		return root ? resolve(root, e) : null;
	};
}

// Resolve symlinks on the longest existing prefix, so a path cannot escape a root through a link.
function realish(p) {
	let head = resolve(p);
	const tail = [];
	while (!exists(head)) {
		const up = dirname(head);
		if (up === head) break;
		tail.unshift(head.slice(up.length + (up.endsWith(sep) ? 0 : 1)));
		head = up;
	}
	let real = head;
	try {
		real = realpathSync(head);
	} catch {}
	return tail.length ? join(real, ...tail) : real;
}

async function loadManifest(src) {
	let text;
	if (/^https:\/\//.test(src)) {
		const res = await fetch(src);
		if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status}`);
		text = Buffer.from(await res.arrayBuffer());
	} else if (/^file:\/\//i.test(src)) {
		text = readFileSync(fileURLToPath(src));
	} else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) {
		throw new Error('manifest must be an https URL or a local file (path or file:// URL)');
	} else {
		text = readFileSync(src);
	}
	return { hash: sha(text), data: JSON.parse(text.toString('utf8')), src };
}

function loadJSON(path) {
	const buf = readFileSync(path);
	return { hash: sha(buf), data: JSON.parse(buf.toString('utf8')) };
}

// ---------- record checks ----------

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
			if ('record_update' in e && typeof e.record_update !== 'boolean') errs.push(`${name}.record_update must be true or false`);
		});
	if (r.renders != null) {
		if (!Array.isArray(r.renders)) errs.push('renders must be an array');
		else {
			const seen = new Set();
			r.renders.forEach((x, i) => {
				if (!isObj(x) || !isStr(x.gate) || typeof x.sha256 !== 'string') return errs.push(`renders[${i}] needs gate and sha256`);
				if (seen.has(x.gate)) errs.push(`renders holds gate ${x.gate} twice: replace the record's renders with this run's, do not add to them`);
				seen.add(x.gate);
			});
		}
	}
	return errs;
}

// Every entry list check skips malformed entries; the shape check already reports them.
const goodEntries = (r) => (Array.isArray(r?.entries) ? r.entries.filter((e) => isObj(e) && isStr(e.id) && isStr(e.target)) : []);
const applied = (e) => e.status !== 'rejected';
// A0, the record update on a re-run, changes the record itself. The record cannot hold its own
// after hash, so these entries are checked by their backup and the pin, not by hash chain or drift.
const recordUpdate = (e) => e.record_update === true;

function byTarget(entries, resolvePath) {
	const map = new Map();
	for (const e of entries.filter(applied).filter((x) => !recordUpdate(x))) {
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
	if (Array.isArray(r.renders)) r.renders.forEach((x, i) => isObj(x) && test(`renders[${i}] gate ${x.gate}`, x.sha256));
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
	result() {
		return `RESULT: ${this.failed ? 'FAIL' : 'PASS'} (${this.total - this.failed} of ${this.total} checks passed)`;
	}
}

function manifestPrinciples(m) {
	return (Array.isArray(m?.pages) ? m.pages : []).filter((p) => isObj(p) && p.section === 'principles' && p.status === 'ratified').map((p) => p.title);
}

function installChecks(rep, rec, man, opts, plan) {
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
		else pageLines.push(`  "${p.title}" record ${h(p.sha256)} = manifest ${h(mpages.get(p.title))}`);
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

	const bk = backupCheck(groups, resolvePath);
	rep.check('backups', bk.problems, `${bk.lines.length} backups present and equal their before hash`);
	if (!bk.problems.length) bk.lines.forEach((l) => rep.info(l));

	const ru = recordUpdateCheck(entries, resolvePath, opts.record);
	rep.check('record-update', ru.problems, `${ru.lines.length} record updates (A0), each with a backup equal to its before hash`);
	if (!ru.problems.length) ru.lines.forEach((l) => rep.info(l));

	const rh = renderHashProblems(r, plan);
	rep.check('render-hashes', rh.problems, rh.pass);
	if (!rh.problems.length) rh.lines.forEach((l) => rep.info(l));

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
	if (plan) planChecks(rep, plan, man, { rec: r, recordPath: opts.record });
}

// A backup holds the file as it was just before its entry's change, so it equals that entry's
// before hash. The first change to a file in a run takes a backup; a later change to the same
// file in that run takes backup null, because its before is the previous change's after.
function backupCheck(groups, resolvePath) {
	const problems = [];
	const lines = [];
	for (const [target, list] of groups) {
		list.forEach((e, i) => {
			if (i === 0 && e.before_sha256 != null && e.backup == null) problems.push(`${e.id}: first change to ${target} has no backup`);
			if (e.backup == null) return;
			const path = resolvePath(e.backup);
			const actual = fileSha(path);
			if (actual == null) problems.push(`${e.id}: backup ${path} missing`);
			else if (actual !== e.before_sha256) {
				const reused = list.slice(0, i).some((p) => p.backup === e.backup);
				problems.push(`${e.id}: backup ${path} ${h(actual)} != before ${h(e.before_sha256)}${reused ? `; this backup belongs to an earlier change to ${target}: a later change in the same run takes backup null` : ''}`);
			} else lines.push(`  ${e.id} ${path} ${h(actual)}`);
		});
	}
	return { problems, lines };
}

// A0 changes the record: it must target the record, keep a backup equal to its before hash, and
// leave after_sha256 null (the record cannot hold its own hash). The pin check proves its effect.
function recordUpdateCheck(entries, resolvePath, recordPath) {
	const problems = [];
	const lines = [];
	const self = resolve(recordPath);
	for (const e of entries.filter(recordUpdate).filter(applied)) {
		if (resolvePath(e.target) !== self) problems.push(`${e.id}: record_update entry targets ${resolvePath(e.target)}, not the record ${self}`);
		if (e.after_sha256 != null) problems.push(`${e.id}: a record update takes after_sha256 null: the record cannot hold its own hash`);
		if (!isStr(e.backup)) {
			problems.push(`${e.id}: a record update needs a backup of the record taken before it`);
			continue;
		}
		const path = resolvePath(e.backup);
		const actual = fileSha(path);
		if (actual == null) problems.push(`${e.id}: record backup ${path} missing`);
		else if (actual !== e.before_sha256) problems.push(`${e.id}: record backup ${path} ${h(actual)} != before ${h(e.before_sha256)}`);
		else lines.push(`  ${e.id} record backup ${path} ${h(actual)}`);
	}
	return { problems, lines };
}

// The record keeps each approved gate render as a hash only; render files live in the run's
// temporary folder and are gone after it. So the files are checked only within a run (with
// --plan): each plan render file must still equal its approved sha256, and a record written in
// this run must hold the same hashes. After the run the stored hashes are shown, and no file is read.
const writtenThisRun = (plan, r) =>
	proposalsOf(plan).some((x) => ['approved', 'edited and approved'].includes(x.decision) && goodEntries(r).some((e) => e.id === x.id));

function renderHashProblems(r, plan) {
	const problems = [];
	const lines = [];
	const stored = Array.isArray(r?.renders) ? r.renders.filter((x) => isObj(x) && isStr(x.gate)) : [];
	const planned = isObj(plan?.renders) ? Object.entries(plan.renders).filter(([, v]) => isObj(v)) : [];
	if (!planned.length) {
		for (const x of stored) lines.push(`  gate ${x.gate} stored ${h(x.sha256)}`);
		return { problems, lines, pass: `${stored.length} approved gate renders stored as hashes; render files belong to their run and are not read` };
	}
	const rp = planResolver(plan);
	for (const [gate, v] of planned) {
		const path = isStr(v.file) ? rp(v.file) : null;
		const actual = path ? fileSha(path) : null;
		if (actual == null) problems.push(`gate ${gate}: render file ${path ?? v.file} missing`);
		else if (actual !== v.sha256) problems.push(`gate ${gate}: render file ${path} ${h(actual)} != approved ${h(v.sha256)}`);
		else lines.push(`  gate ${gate} ${path} ${h(actual)}`);
	}
	const fresh = writtenThisRun(plan, r);
	if (fresh)
		for (const [gate, v] of planned) {
			const rec = stored.find((x) => x.gate === gate);
			if (!rec) problems.push(`gate ${gate}: plan.renders has it, the record's renders do not: replace the record's renders with this run's`);
			else if (rec.sha256 !== v.sha256) problems.push(`gate ${gate}: record ${h(rec.sha256)} != plan ${h(v.sha256)}: replace the record's renders with this run's`);
		}
	else lines.push('  record not written in this run: its renders are an earlier run\'s and are not compared');
	return { problems, lines, pass: `${planned.length} approved gate renders in this run, each file equal to its approved sha256${fresh ? ' and to the record' : ''}` };
}

function uninstallChecks(rep, opts, plan) {
	const record = resolve(opts.record);
	const base = record.replace(/\.json$/, '');
	const left = [record, `${base}.pointer`, `${base}.trust`].filter(exists);
	rep.check('record-absent', left.map((p) => `still present: ${p}`), `${record} and its pointer and trust files are absent`);

	let rec;
	try {
		rec = loadJSON(opts.recordBackup);
	} catch (err) {
		rep.check('record-backup', [`cannot read ${opts.recordBackup}: ${err.message}`], '');
		return null;
	}
	rep.info(`record backup: ${resolve(opts.recordBackup)} ${h(rec.hash)}`);
	const shape = shapeErrors(rec.data);
	rep.check('record-backup', shape, 'readable, required fields present');
	if (!isObj(rec.data)) return rec;

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
	if (plan) rep.check('scope', scopeProblems(plan, rec.data, opts.record), 'every target, backup, and record path lies inside the scope roots');
	return rec;
}

// ---------- plan checks ----------

function planShape(p) {
	const errs = [];
	if (!isObj(p)) return ['plan is not a JSON object'];
	if (p.schema !== 1) errs.push('plan.schema must be 1');
	if (!RUNS.includes(p.run)) errs.push(`plan.run must be one of: ${RUNS.join(', ')}`);
	if (!MODES.includes(p.mode)) errs.push(`plan.mode must be one of: ${MODES.join(', ')}`);
	if (!isObj(p.harness) || !isStr(p.harness.name)) errs.push('plan.harness.name required');
	if (!isObj(p.scope) || !Array.isArray(p.scope.roots) || !p.scope.roots.length || !p.scope.roots.every(isStr))
		errs.push('plan.scope.roots (non-empty array of paths) required');
	else for (const r of p.scope.roots) if (!isAbsolute(expandHome(r))) errs.push(`scope root "${r}" must be absolute or ~/-prefixed`);
	if (p.evidence != null && !isObj(p.evidence)) errs.push('plan.evidence must be an object keyed by item id');
	if (!Array.isArray(p.proposals)) errs.push('plan.proposals (array) required');
	else
		p.proposals.forEach((x, i) => {
			if (!isObj(x)) return errs.push(`proposals[${i}] is not an object`);
			const n = isStr(x.id) ? x.id : `proposals[${i}]`;
			for (const k of ['id', 'title', 'page', 'answer']) if (!isStr(x[k])) errs.push(`${n}.${k} required`);
			if (!Array.isArray(x.targets) || !x.targets.every(isStr)) errs.push(`${n}.targets (array of paths) required`);
			if (!isObj(x.options)) errs.push(`${n}.options required`);
			else
				for (const o of OPTIONS) {
					const v = x.options[o];
					if (!isObj(v) || !(isStr(v.not_possible) || (isStr(v.affects) && Array.isArray(v.files) && v.files.length)))
						errs.push(`${n}.options["${o}"] needs affects and files, or not_possible`);
				}
			if (x.pick != null && !PICKS.includes(x.pick)) errs.push(`${n}.pick "${x.pick}" not one of: ${PICKS.join(', ')}`);
			if (x.decision != null && !DECISIONS.includes(x.decision)) errs.push(`${n}.decision "${x.decision}" not one of: ${DECISIONS.join(', ')}`);
			if (p.run !== 'uninstall') {
				const t = x.tradeoff;
				if (!isObj(t) || !isStr(t.costs) || !isStr(t.saves) || !isStr(t.net) || typeof t.flag !== 'boolean')
					errs.push(`${n}.tradeoff needs costs, saves, net, and flag (true or false)`);
				else if (t.flag && !(Array.isArray(t.dimensions) && t.dimensions.filter(isStr).length >= 2))
					errs.push(`${n}.tradeoff.flag is true: name both dimensions`);
				if (!RISKS.includes(x.risk)) errs.push(`${n}.risk must be one of: ${RISKS.join(', ')}`);
				if (!isStr(x.model)) errs.push(`${n}.model required: the model or tier that designed it`);
				if (!isObj(x.review) || !Array.isArray(x.review.reviewers)) errs.push(`${n}.review.reviewers (array) required`);
				else
					x.review.reviewers.forEach((r, j) => {
						if (!isObj(r) || !isStr(r.who) || !isStr(r.how) || !Array.isArray(r.findings)) errs.push(`${n}.review.reviewers[${j}] needs who, how, and findings (array)`);
						else r.findings.forEach((f, k) => {
							if (!isObj(f) || !isStr(f.finding) || !isStr(f.resolution)) errs.push(`${n}.review.reviewers[${j}].findings[${k}] needs finding and resolution`);
						});
					});
				if (x.nudge != null) {
					const g = x.nudge;
					if (!isObj(g) || !isStr(g.row) || !isStr(g.trigger) || typeof g.advisory !== 'boolean' || !isStr(g.rate_limit) || !isStr(g.disable))
						errs.push(`${n}.nudge needs row, trigger, advisory (true or false), rate_limit, and disable`);
				}
			}
		});
	if (!DELIVERY.includes(p.delivery)) errs.push(`plan.delivery must be one of: ${DELIVERY.join(', ')}`);
	else if (p.delivery === 'inline' && !isStr(p.delivery_reason)) errs.push('plan.delivery "inline" needs delivery_reason: why the user cannot open render files');
	if (p.renders != null && !isObj(p.renders)) errs.push('plan.renders must be an object keyed by gate');
	for (const [g, v] of Object.entries(isObj(p.renders) ? p.renders : {}))
		if (!isObj(v) || !isStr(v.file) || typeof v.sha256 !== 'string') errs.push(`plan.renders["${g}"] needs file and sha256`);
	if (p.load != null && !Array.isArray(p.load)) errs.push('plan.load must be an array');
	for (const l of Array.isArray(p.load) ? p.load : []) {
		if (!isObj(l) || !isStr(l.path) || !LOADS.includes(l.loads)) errs.push(`load entry needs path and loads (${LOADS.join(', ')})`);
		else if (l.fresh != null && !isObj(l.fresh)) errs.push(`load entry ${l.path}: fresh must be an object`);
	}
	for (const k of ['scan', 'corrections']) if (p[k] != null && !Array.isArray(p[k])) errs.push(`plan.${k} must be an array`);
	for (const s of Array.isArray(p.scan) ? p.scan : [])
		if (!isObj(s) || !isStr(s.row) || !isStr(s.evidence) || !isStr(s.outcome)) errs.push('scan finding needs row, evidence, source, and outcome');
	for (const c of Array.isArray(p.corrections) ? p.corrections : [])
		if (!isObj(c) || !isStr(c.text) || !ORIGINS.includes(c.origin)) errs.push(`correction needs text and origin (${ORIGINS.join(', ')})`);
	if (p.signals != null && !isObj(p.signals)) errs.push('plan.signals must be an object');
	if (p.report != null && !isObj(p.report)) errs.push('plan.report must be an object');
	return errs;
}

// The risk class sets the reviewer minimum. Code-running wins over what the plan declares.
const riskOf = (x) => (x.runs_code ? 'code' : RISKS.includes(x.risk) ? x.risk : 'local text');

// Adversarial review before Gate 4: enough independent reviewers for the risk, one of them
// checking undo when code runs, or an explicit "self only" mark with its reason.
function reviewProblems(x) {
	const problems = [];
	const risk = riskOf(x);
	const min = MIN_REVIEWERS[risk];
	const rs = Array.isArray(x.review?.reviewers) ? x.review.reviewers.filter(isObj) : [];
	const selfOnly = isStr(x.review?.self_only);
	if (rs.length < min && !selfOnly) problems.push(`${x.id}: ${rs.length} reviewers, ${risk} needs at least ${min}, or mark the review "self only" with why no other reviewer is available`);
	if (risk === 'code' && !selfOnly && !rs.some((r) => r.checks_undo === true)) problems.push(`${x.id}: runs code, so one reviewer must check its undo (checks_undo: true)`);
	if (selfOnly && rs.length >= min) problems.push(`${x.id}: marked "self only" but lists ${rs.length} reviewers: drop one or the other`);
	for (const r of rs)
		for (const f of Array.isArray(r.findings) ? r.findings.filter(isObj) : []) if (!isStr(f.resolution)) problems.push(`${x.id}: finding "${f.finding}" from ${r.who} has no resolution`);
	return problems;
}

// Table rows of the fetched Anti-patterns index, as "<section> / <symptom>" and by symptom alone.
function indexRows(plan, rp) {
	const page = (plan.pages ?? []).find((p) => isObj(p) && p.title === INDEX_TITLE && isStr(p.file));
	if (!page) return null;
	let text;
	try {
		text = readFileSync(rp(page.file) ?? '', 'utf8');
	} catch {
		return null;
	}
	const rows = new Set();
	let section = '';
	for (const line of text.split('\n')) {
		const hm = /^## (.+)$/.exec(line);
		if (hm) section = hm[1].trim();
		const rm = /^\| ([^|]+?) \| ([^|]+?) \|/.exec(line);
		if (rm && rm[1] !== 'Symptom' && !/^-+$/.test(rm[1])) {
			rows.add(rm[1].trim());
			rows.add(`${section} / ${rm[1].trim()}`);
		}
	}
	return rows;
}

function scanProblems(plan, rp) {
	const problems = [];
	const rows = indexRows(plan, rp);
	const ids = new Set(proposalsOf(plan).map((x) => x.id));
	for (const s of (Array.isArray(plan.scan) ? plan.scan : []).filter(isObj)) {
		if (rows && !rows.has(s.row)) problems.push(`finding "${s.row}" is not a row of the fetched ${INDEX_TITLE} index`);
		if (!TOOL_SOURCE.test(s.source ?? '')) problems.push(`finding "${s.row}": evidence needs tool output ($ <command> or (probe: ...)), not recall`);
		const m = /^proposal (\S+)$/.exec(s.outcome ?? '');
		if (m && !ids.has(m[1])) problems.push(`finding "${s.row}": outcome names unknown proposal ${m[1]}`);
		else if (!m && s.outcome !== 'advice') problems.push(`finding "${s.row}": outcome must be "proposal <id>" or "advice"`);
	}
	for (const x of proposalsOf(plan)) {
		const g = x.nudge;
		if (!isObj(g)) continue;
		if (rows && !rows.has(g.row)) problems.push(`${x.id}: nudge row "${g.row}" is not a row of the fetched ${INDEX_TITLE} index`);
		if (g.advisory === false && !isStr(g.blocking_quote)) problems.push(`${x.id}: a nudge that blocks needs the user's words asking for it (blocking_quote); nudges are advisory by default`);
	}
	return problems;
}

// Every string in the plan: a short or ellipsized hash in prose fails, so a hash is printed in
// full or pointed to by its render line.
function planHashProblems(plan) {
	const problems = [];
	const walk = (v, path) => {
		if (typeof v === 'string') for (const i of hashIssues(v)) problems.push(`${path}: ${i}`);
		else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
		else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
	};
	walk(plan, '');
	return problems;
}

// A load proof counts only from a fresh session opened after the write. A pre-write status is a hint.
const freshOk = (f) => isObj(f) && f.after_write === true && f.session === 'fresh' && LOAD_SOURCE.test(f.source ?? '') && LOADS.includes(f.loads);

function freshShapeProblems(plan) {
	const problems = [];
	for (const l of (Array.isArray(plan.load) ? plan.load : []).filter((x) => isObj(x) && x.fresh != null)) {
		if (!freshOk(l.fresh) && !isStr(l.fresh?.accepted))
			problems.push(`${l.path}: a load proof counts only with session "fresh", after_write true, loads, and a source ($ <command>, (probe: ...), or (user))`);
	}
	return problems;
}

function scopeProblems(plan, rec, recordPath) {
	const problems = [];
	if (!isObj(plan?.scope) || !Array.isArray(plan.scope.roots)) return ['plan.scope.roots missing'];
	const roots = plan.scope.roots.filter(isStr).map((r) => realish(expandHome(r)));
	const inside = (abs) => {
		const real = realish(abs);
		return roots.some((r) => real === r || real.startsWith(r.endsWith(sep) ? r : r + sep));
	};
	const test = (label, abs, raw) => {
		if (abs == null) problems.push(`${label} "${raw}" is relative and plan.project_root is missing`);
		else if (!inside(abs)) problems.push(`${label} ${abs} is outside the scope roots (${plan.scope.roots.join(', ')})`);
	};
	const rp = planResolver(plan);
	for (const x of Array.isArray(plan.proposals) ? plan.proposals.filter(isObj) : [])
		for (const t of Array.isArray(x.targets) ? x.targets.filter(isStr) : []) test(`${x.id} target`, rp(t), t);
	for (const b of Array.isArray(plan.bookkeeping) ? plan.bookkeeping.filter(isObj) : []) {
		if (isStr(b.record)) test('bookkeeping record', rp(b.record), b.record);
		if (isStr(b.backups)) test('bookkeeping backups', rp(b.backups), b.backups);
	}
	if (rec && recordPath) {
		const rr = resolver(recordPath);
		test('record', resolve(recordPath), recordPath);
		for (const e of goodEntries(rec)) {
			test(`${e.id} target`, rr(e.target), e.target);
			if (isStr(e.backup)) test(`${e.id} backup`, rr(e.backup), e.backup);
		}
	}
	return problems;
}

// Load entries keyed by real path. `pre` is the pre-write hint; `fresh` is the proof after the write.
function loadMap(plan) {
	const rp = planResolver(plan);
	const map = new Map();
	for (const l of Array.isArray(plan.load) ? plan.load.filter(isObj) : []) {
		const abs = isStr(l.path) ? rp(l.path) : null;
		if (!abs) continue;
		const pre = l.loads === 'yes' && !LOAD_SOURCE.test(l.source ?? '') ? 'yes without a load source' : l.loads;
		map.set(realish(abs), { entry: l, pre });
	}
	return map;
}

const liveProposal = (x) => x.decision !== 'rejected' && x.pick !== 'reject';

// Pre-write hints for the menus: a target this harness is not yet shown to load.
function loadHints(plan, x) {
	if (plan.run === 'uninstall') return [];
	const rp = planResolver(plan);
	const map = loadMap(plan);
	const hints = [];
	for (const t of Array.isArray(x.targets) ? x.targets.filter(isStr) : []) {
		const abs = rp(t);
		const s = abs ? map.get(realish(abs)) : undefined;
		if (s && s.pre !== 'yes') hints.push(`load hint: ${t} is "${s.pre}" before the write; Phase 6 proves it loads in a fresh session, or you accept it as not loading`);
	}
	return hints;
}

// Final Gate 6.1: every always-loaded target of an applied proposal needs a fresh-session proof
// after the write, or the user's acceptance that it does not load.
function freshLoadLines(plan) {
	const rp = planResolver(plan);
	const map = loadMap(plan);
	const lines = [];
	let mark = 'x';
	const seen = new Set();
	for (const x of proposalsOf(plan).filter(liveProposal).filter((p) => p.always_loaded)) {
		for (const t of (x.targets ?? []).filter(isStr)) {
			const abs = rp(t);
			const key = abs ? realish(abs) : t;
			if (seen.has(key)) continue;
			seen.add(key);
			const f = map.get(key)?.entry?.fresh;
			if (isObj(f) && isStr(f.accepted)) lines.push(`${t}: not loading, accepted: "${f.accepted}" (user)`);
			else if (!freshOk(f)) {
				mark = ' ';
				lines.push(`${t}: no load proof from a fresh session after the write [open a fresh session and check with the harness's own load inspection, or record the user's acceptance that it does not load]`);
			} else if (f.loads !== 'yes') {
				mark = ' ';
				lines.push(`${t}: does not load in a fresh session  ${f.source} [fix it, or record the user's acceptance that it does not load]`);
			} else lines.push(`${t}: loads in a fresh session after the write${isStr(f.how) ? ` (${f.how})` : ''}  ${f.source}`);
		}
	}
	return { mark, lines };
}

function coverageProblems(plan, m) {
	if (plan.run === 'uninstall') return [];
	const want = manifestPrinciples(m);
	const ids = new Set((Array.isArray(plan.proposals) ? plan.proposals : []).filter(isObj).map((x) => x.id));
	const got = new Map((Array.isArray(plan.principles) ? plan.principles : []).filter(isObj).map((p) => [p.title, p]));
	const problems = [];
	if (!want.length) problems.push('manifest lists no ratified principles');
	for (const t of want) {
		const p = got.get(t);
		if (!p) problems.push(`"${t}" missing from plan.principles`);
		else if (!COVERAGE.includes(p.status)) problems.push(`"${t}" status "${p.status}" not one of: ${COVERAGE.join(', ')}`);
		else if (!isStr(p.reason)) problems.push(`"${t}" has no reason`);
		else if (p.status === 'applied') {
			const list = Array.isArray(p.proposals) ? p.proposals : [];
			if (!list.length) problems.push(`"${t}" applied names no proposal`);
			for (const id of list) if (!ids.has(id)) problems.push(`"${t}" applied names unknown proposal ${id}`);
		}
	}
	for (const t of got.keys()) if (!want.includes(t)) problems.push(`"${t}" is not a ratified principle in the manifest`);
	return problems;
}

function planChecks(rep, plan, man, ctx) {
	const shape = planShape(plan);
	rep.check('plan-shape', shape, `plan fields present; ${plan.proposals?.length ?? 0} proposals`);
	if (!isObj(plan)) return;
	rep.check('scope', scopeProblems(plan, ctx.rec, ctx.recordPath), `every target, backup, and record path lies inside the scope roots: ${(plan.scope?.roots ?? []).join(', ')}`);
	rep.check('load', freshShapeProblems(plan), 'every load proof comes from a fresh session after the write, or is accepted as not loading');
	if (man) rep.check('coverage', coverageProblems(plan, man.data), `${manifestPrinciples(man.data).length} ratified principles each have a status and a reason`);
	if (plan.run !== 'uninstall') {
		const ps = proposalsOf(plan);
		rep.check('review', ps.flatMap(reviewProblems), `${ps.length} proposals each reviewed by enough independent reviewers for their risk, or marked self only`);
		rep.check('scan', scanProblems(plan, planResolver(plan)), `${(plan.scan ?? []).length} anti-pattern findings and ${ps.filter((x) => isObj(x.nudge)).length} nudges each tied to an index row`);
	}
	rep.check('plan-hashes', planHashProblems(plan), 'no short or shortened hash anywhere in the plan');
}

// ---------- rendering ----------

function framed(kind, body) {
	return [`--- shrine-check ${VERSION} render ${kind} (paste verbatim) ---`, ...body, `--- end render ${kind} sha256:${sha(body.join('\n'))} ---`];
}

// The exact bytes of a render file, so a hash of it can be recomputed from the plan.
const renderText = (kind, body) => `${framed(kind, body).join('\n')}\n`;

// The design the menus show: every proposal field except the user's replies. The menus print
// its hash, so a plan edit after the menus were shown changes the menus hash and blocks 4.9.
const REPLIES = ['pick', 'ack', 'decision', 'quote'];
const designSha = (plan) => sha(JSON.stringify(proposalsOf(plan).map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !REPLIES.includes(k))))));

function menuBody(plan) {
	const out = [`plan design sha256:${designSha(plan)}`];
	for (const x of (plan.proposals ?? []).filter(isObj)) {
		out.push(`${x.id} ${x.title}`);
		if (plan.run !== 'uninstall') {
			out.push(`  page: ${x.page}; traces to: ${x.answer}; runs code: ${x.runs_code ? 'yes' : 'no'}; always loaded: ${x.always_loaded ? `yes, prevents: ${x.miss ?? '<missing>'}` : 'no'}`);
			const t = x.tradeoff ?? {};
			out.push(`  ${t.flag ? `trade-off (${(t.dimensions ?? []).join(' vs ')})` : 'no trade-off'}: costs ${t.costs}; saves ${t.saves}; net ${t.net}`);
			const rs = (x.review?.reviewers ?? []).filter(isObj);
			out.push(`  risk: ${riskOf(x)}; designed by: ${x.model}; reviewed by: ${isStr(x.review?.self_only) ? 'self only' : `${rs.length} independent reviewer${rs.length === 1 ? '' : 's'}`}`);
			if (isObj(x.nudge)) out.push(`  nudge for "${x.nudge.row}": when ${x.nudge.trigger}; ${x.nudge.advisory ? 'advisory' : 'blocking'}; at most ${x.nudge.rate_limit}; turn off: ${x.nudge.disable}`);
			for (const hint of loadHints(plan, x)) out.push(`  ${hint}`);
		}
		out.push(`  targets: ${(x.targets ?? []).join(', ') || 'none'}`);
		OPTIONS.forEach((o, i) => {
			const v = x.options?.[o] ?? {};
			const label = `[${i + 1}] ${o}`.padEnd(24);
			if (isStr(v.not_possible)) out.push(`  ${label}not possible: ${v.not_possible}`);
			else out.push(`  ${label}affects: ${v.affects}; files: ${(v.files ?? []).join(', ')}${isStr(v.via) ? ` (${v.via})` : ''}`);
		});
		out.push(`  ${'[4] reject'.padEnd(24)}affects: nobody; files: none`);
		out.push('  Pick 1, 2, 3, or 4 (with edits, if any).');
		if (isStr(x.preselected)) out.push(`  pre-selected: [${PICKS.indexOf(x.preselected) + 1}]`);
	}
	return out;
}

const menuSha = (plan) => sha(menuBody(plan).join('\n'));

function hashIssues(text) {
	const issues = [];
	for (const m of String(text).matchAll(/sha256:([0-9a-fA-F]*)/g)) if (!HEX64.test(m[1])) issues.push(`short or malformed hash "sha256:${m[1]}"`);
	if (/\b[0-9a-f]{6,63}(\.\.\.|…)/.test(text)) issues.push('shortened hash');
	return issues;
}

const MARKS = { x: '[x]', '-': '[-]', ' ': '[ ]', wait: '[ ]' };
const worst = (a, b) => {
	const rank = { x: 0, '-': 0, wait: 1, ' ': 2 };
	return rank[b] > rank[a] ? b : a;
};

// One item from plan evidence: mark, text, source, and files the checker hashes itself.
function fromEvidence(ev, rp) {
	if (!isObj(ev)) return null;
	const mark = ['x', '-', ' ', 'wait'].includes(ev.mark) ? ev.mark : ' ';
	const text = isStr(ev.text) ? ev.text : '';
	let m = mark;
	const notes = [];
	const sub = [];
	if (mark === 'x' && !SOURCE.test(ev.source ?? '')) {
		m = ' ';
		notes.push('no source: end with $ <command>, (user), (plan), or (probe: ...)');
	}
	if (mark === '-' && !text) {
		m = ' ';
		notes.push('[-] needs a reason');
	}
	if (/\.\.\.|…/.test(ev.source ?? '')) {
		m = ' ';
		notes.push('abridged command: name the command in full');
	}
	for (const i of hashIssues(text)) {
		m = ' ';
		notes.push(i);
	}
	for (const f of Array.isArray(ev.files) ? ev.files.filter(isStr) : []) {
		const abs = rp(f);
		const s = abs ? fileSha(abs) : null;
		if (s == null) {
			m = worst(m, ' ');
			sub.push(`      ${f}: not found`);
		} else sub.push(`      ${abs} ${h(s)}  $ shrine-check sha256`);
	}
	const src = isStr(ev.source) ? `  ${ev.source}` : '';
	const prefix = mark === 'wait' ? 'awaiting: ' : mark === '-' && !/^not applicable/.test(text) ? 'not applicable: ' : '';
	return { mark: m, text: `${prefix}${text}${notes.length ? ` [${notes.join('; ')}]` : ''}${src}`, sub };
}

function pageLine(plan, man, title, rp) {
	const want = (man?.data?.pages ?? []).find((p) => p.title === title)?.sha256;
	const got = (plan.pages ?? []).find((p) => isObj(p) && p.title === title);
	if (!got) return null;
	const actual = isStr(got.file) ? fileSha(rp(got.file) ?? '') : null;
	if (want == null) return { mark: ' ', text: `"${title}" not in manifest` };
	if (actual == null) return { mark: ' ', text: `"${title}" fetched bytes not found at ${got.file}` };
	const ok = actual === want;
	return { mark: ok ? 'x' : ' ', text: `"${title}" expected ${h(want)} actual ${h(actual)} ${ok ? 'match' : 'MISMATCH: abort'}  $ shrine-check sha256 ${got.file}` };
}

const proposalsOf = (plan) => (plan.proposals ?? []).filter(isObj);
const quote = (s) => (isStr(s) ? `"${s}"` : '<missing>');

// Items the checker computes from the plan, the manifest, and the record.
function computed(id, ctx) {
	const { plan, man, rp } = ctx;
	const ps = proposalsOf(plan);
	const lines = [];
	let mark = 'x';
	const fail = (t) => {
		mark = worst(mark, ' ');
		lines.push(t);
	};
	const wait = (t) => {
		mark = worst(mark, 'wait');
		lines.push(t);
	};
	switch (id) {
		case '1.1': {
			const load = (plan.load ?? []).filter(isObj);
			if (!load.length) return null;
			for (const l of load) {
				const ok = l.loads !== 'yes' || LOAD_SOURCE.test(l.source ?? '');
				const t = `${l.path}: loads ${l.loads} (pre-write hint; Phase 6 proves load in a fresh session)${isStr(l.source) ? `  ${l.source}` : ''}`;
				if (ok) lines.push(t);
				else fail(`${t} [a "yes" needs the harness's load listing ($ <command>), a (probe: ...), or (user); else mark it unverified]`);
			}
			return { mark, lines };
		}
		case '1.13': {
			if (!Array.isArray(plan.scan)) return null;
			const rows = indexRows(plan, rp);
			const head = rows ? `${plan.scan.length} findings against the ${INDEX_TITLE} index  $ shrine-check (plan scan, fetched index)` : `${plan.scan.length} findings; the ${INDEX_TITLE} index is not in plan.pages, so rows are not matched  (plan)`;
			for (const s of plan.scan.filter(isObj)) {
				const t = `"${s.row}": ${s.evidence}  ${s.source ?? '<no source>'}${isStr(s.fix) ? `; fix: ${s.fix}` : ''}`;
				if (rows && !rows.has(s.row)) fail(`${t} [not a row of the index]`);
				else if (!TOOL_SOURCE.test(s.source ?? '')) fail(`${t} [needs tool output: $ <command> or (probe: ...)]`);
				else lines.push(t);
			}
			if (!plan.scan.length) lines.push('no anti-pattern found  (plan)');
			return { mark, head, lines };
		}
		case '1.14': {
			const s = plan.signals;
			if (!isObj(s)) return null;
			if (s.consent === 'declined' || s.consent === 'not available') return { mark: '-', lines: [`not applicable: session history ${s.consent}${isStr(s.why) ? `: ${s.why}` : ''}; corrections are recalled  (plan)`] };
			if (!isStr(s.consent)) return { mark: 'wait', lines: ['awaiting: the user\'s consent to read local session history (read-only, local only)'] };
			lines.push(`consent: "${s.consent}" (user); read-only, local only, nothing leaves this machine`);
			const metrics = (Array.isArray(s.metrics) ? s.metrics : []).filter(isObj);
			for (const x of metrics) {
				const t = `${x.name}: ${x.value}${isStr(x.window) ? ` over ${x.window}` : ''}  ${x.source ?? '<no source>'}`;
				if (TOOL_SOURCE.test(x.source ?? '')) lines.push(t);
				else fail(`${t} [needs tool output: $ <command>]`);
			}
			if (!metrics.length) fail('no metric read: list each signal with its command');
			return { mark, lines };
		}
		case '2.1': {
			if (!man) return { mark: ' ', lines: ['needs --manifest'] };
			const m = man.data;
			return { mark, lines: [`${man.src} ${h(man.hash)}; commit ${m.commit}; prompt.version ${m.prompt?.version}; prompt.sha256 ${h(m.prompt?.sha256)}; checker.sha256 ${h(m.checker?.sha256)}  $ shrine-check --manifest ${man.src}`] };
		}
		case '2.3':
		case '2.4': {
			const l = pageLine(plan, man, id === '2.3' ? 'Correction Diagnosis' : 'Fail Fast, Recover Smart', rp);
			return l ? { mark: l.mark, lines: [l.text] } : null;
		}
		case '2.7': {
			if (!man) return { mark: ' ', lines: ['needs --manifest'] };
			const t = manifestPrinciples(man.data);
			return { mark: t.length ? 'x' : ' ', lines: [`${t.length} ratified: ${t.map((x) => (x.startsWith('North Star') ? `${x} (North Star)` : x)).join('; ')}  $ shrine-check (manifest section principles, status ratified)`] };
		}
		case '3.7': {
			const s = plan.scope ?? {};
			return { mark: isStr(s.quote) ? 'x' : ' ', lines: [`choice ${quote(s.choice)}; roots: ${(s.roots ?? []).join(', ')}; ${quote(s.quote)} (user)`] };
		}
		case '4.1': {
			const pages = (plan.pages ?? []).filter(isObj);
			if (!pages.length) return null;
			for (const p of pages) {
				const l = pageLine(plan, man, p.title, rp);
				if (l.mark === 'x') lines.push(l.text);
				else fail(l.text);
			}
			return { mark, lines };
		}
		case '4.2': {
			const sp = scopeProblems(plan);
			const bk = (plan.bookkeeping ?? []).filter(isObj);
			for (const b of bk) lines.push(`record ${b.record}; backups ${b.backups}  (plan)`);
			if (!bk.length) fail('plan.bookkeeping lists no record and backup location');
			for (const p of sp) fail(`scope: ${p}`);
			if (!sp.length) lines.push(`scope: every target and bookkeeping path inside ${(plan.scope?.roots ?? []).join(', ')}  $ shrine-check scope`);
			return { mark, lines };
		}
		case '4.5': {
			const titles = new Set((man?.data?.pages ?? []).map((p) => p.title));
			for (const x of ps) {
				const t = `${x.id}: page "${x.page}"; answer "${x.answer}"  (plan)`;
				if (man && !titles.has(x.page)) fail(`${t} [page not in manifest]`);
				else lines.push(t);
			}
			if (!ps.length) lines.push('no proposals  (plan)');
			return { mark, lines };
		}
		case '4.9': {
			// File delivery stores the menus render file's sha256; inline delivery stores the end-line hash.
			const want = plan.delivery === 'inline' ? menuSha(plan) : sha(renderText('menus', menuBody(plan)));
			let head;
			const how = `Run --render menus${plan.delivery === 'inline' ? ', paste it, and copy its end-line hash' : ' --out <dir>, have the user open the file, and copy its render sha256'} into menus_sha256`;
			if (plan.menus_sha256 !== want) {
				mark = ' ';
				head = isStr(plan.menus_sha256)
					? `the plan changed after the menus were rendered: plan.menus_sha256 ${h(plan.menus_sha256)} != current menus sha256:${want}. ${how}, then ask for each pick again and set picks_menus_sha256`
					: `menus not shown as rendered: plan.menus_sha256 ${h(null)} != current menus sha256:${want}. ${how}`;
			} else head = `menus shown: sha256:${want}, ${ps.length} proposals, 4 options each  $ shrine-check --render menus`;
			const stalePicks = plan.menus_sha256 === want && ps.some((x) => x.pick != null) && plan.picks_menus_sha256 !== want;
			if (stalePicks) {
				mark = ' ';
				lines.push(`picks were given on an earlier menus render: show the current menus and ask for each pick again, then set picks_menus_sha256 to sha256:${want}`);
			}
			for (const x of ps) {
				if (x.pick == null) wait(`${x.id}: pick awaiting`);
				else if (x.pick !== 'reject' && !isStr(x.ack)) wait(`${x.id}: [${PICKS.indexOf(x.pick) + 1}] ${x.pick}; acknowledgement of who is affected awaiting`);
				else if (isStr(x.options?.[x.pick]?.not_possible)) fail(`${x.id}: picked [${PICKS.indexOf(x.pick) + 1}] ${x.pick}, which is not possible`);
				else lines.push(`${x.id}: [${PICKS.indexOf(x.pick) + 1}] ${x.pick}${x.pick === 'reject' ? '' : `; affects ${x.options?.[x.pick]?.affects}; ack ${quote(x.ack)}`} (user)`);
			}
			return { mark, head, lines };
		}
		case '4.11': {
			if (!man) return { mark: ' ', lines: ['needs --manifest'] };
			const [count, ...rows] = coverageRows(plan, man);
			for (const p of coverageProblems(plan, man.data)) fail(p);
			lines.push(...rows);
			return { mark, head: `${count}  $ shrine-check (manifest, plan principles)`, lines };
		}
		case '4.12': {
			for (const x of ps) {
				if (!x.decision) wait(`${x.id}: decision awaiting`);
				else if (!isStr(x.quote)) fail(`${x.id}: ${x.decision} [no quote of the user's words]`);
				else lines.push(`${x.id}: ${x.decision}, ${quote(x.quote)} (user)`);
			}
			if (!ps.length) lines.push('no proposals  (plan)');
			return { mark, lines };
		}
		case '4.16': {
			for (const x of ps) {
				const t = x.tradeoff;
				if (!isObj(t) || !isStr(t.costs) || !isStr(t.saves) || !isStr(t.net) || typeof t.flag !== 'boolean') fail(`${x.id}: trade-off fields missing`);
				else lines.push(`${x.id}: ${t.flag ? `trade-off ${t.dimensions.join(' vs ')}` : 'no trade-off'}; costs ${t.costs}; saves ${t.saves}; net ${t.net}  (plan)`);
			}
			return { mark, lines };
		}
		case '3.4': {
			if (!Array.isArray(plan.corrections)) return null;
			for (const c of plan.corrections.filter(isObj)) {
				const t = `${c.origin}: ${c.text}; ${c.class ?? '<class missing>'}${c.class === 'repeated' ? `; tag ${c.tag ?? '<missing>'}; symptom ${c.symptom ?? '<missing>'}` : ''}  ${c.origin === 'measured' ? c.source ?? '<no source>' : '(user)'}`;
				if (!['one-off', 'repeated'].includes(c.class)) fail(`${t} [class must be one-off or repeated]`);
				else if (c.class === 'repeated' && (!isStr(c.tag) || !isStr(c.symptom))) fail(`${t} [a repeated correction needs its tag and the symptom cited]`);
				else if (c.origin === 'measured' && !TOOL_SOURCE.test(c.source ?? '')) fail(`${t} [measured needs the command that read it]`);
				else lines.push(t);
			}
			if (!plan.corrections.length) lines.push('no corrections: none measured, none recalled  (plan)');
			return { mark, lines };
		}
		case '4.19': {
			if (plan.run === 'uninstall') return null;
			const m = isObj(plan.models) ? Object.entries(plan.models).map(([k, v]) => `${k}: ${v}`).join('; ') : null;
			for (const x of ps) {
				const rs = (x.review?.reviewers ?? []).filter(isObj);
				const risk = riskOf(x);
				const probs = reviewProblems(x);
				const count = isStr(x.review?.self_only) ? `self only (${x.review.self_only})` : `${rs.length} of at least ${MIN_REVIEWERS[risk]} reviewers`;
				const t = `${x.id}: designed by ${x.model}; risk ${risk}; ${count}  (plan)`;
				if (probs.length) fail(`${t} [${probs.map((p) => p.replace(`${x.id}: `, '')).join('; ')}]`);
				else lines.push(t);
				for (const r of rs) {
					lines.push(`  ${r.who} via ${r.how}${r.checks_undo ? ', checked undo' : ''}: ${r.findings.length} findings`);
					for (const f of (r.findings ?? []).filter(isObj)) lines.push(`    finding: ${f.finding}; resolution: ${f.resolution ?? '<missing>'}`);
				}
			}
			if (!ps.length) lines.push('no proposals  (plan)');
			return { mark, head: `${m ? `models per step: ${m}; ` : ''}${ps.length} proposals  $ shrine-check (plan review)`, lines };
		}
		case '4.20': {
			if (plan.run === 'uninstall' || !Array.isArray(plan.scan)) return null;
			const ids = new Set(ps.map((x) => x.id));
			for (const s of plan.scan.filter(isObj)) {
				const pm = /^proposal (\S+)$/.exec(s.outcome ?? '');
				const t = `"${s.row}": ${s.outcome}  (plan)`;
				if (pm && !ids.has(pm[1])) fail(`${t} [unknown proposal]`);
				else if (!pm && s.outcome !== 'advice') fail(`${t} [outcome must be "proposal <id>" or "advice"]`);
				else lines.push(t);
			}
			if (!plan.scan.length) lines.push('no findings to resolve  (plan)');
			return { mark, lines };
		}
		case '4.21': {
			if (plan.run === 'uninstall') return null;
			const nudges = ps.filter((x) => isObj(x.nudge));
			if (!nudges.length) return { mark: '-', lines: ['not applicable: no nudge proposed (advice instead, or no mechanically detectable anti-pattern)  (plan)'] };
			const rows = indexRows(plan, rp);
			for (const x of nudges) {
				const g = x.nudge;
				const t = `${x.id}: "${g.row}"; when ${g.trigger}; ${g.advisory ? 'advisory' : 'blocking'}; at most ${g.rate_limit}; turn off: ${g.disable}; runs code: ${x.runs_code ? 'yes, separate approval at 4.8' : 'no'}; costs ${x.tradeoff?.costs}  (plan)`;
				if (rows && !rows.has(g.row)) fail(`${t} [not a row of the index]`);
				else if (!g.advisory && !isStr(g.blocking_quote)) fail(`${t} [blocking needs the user's words asking for it]`);
				else lines.push(t);
			}
			return { mark, lines };
		}
		case '4.22': {
			// No stated or measured deficit: the user still gets the baseline practices that fit,
			// or an explicit "none fit" they acknowledged, and the Individual Baseline offer.
			if (plan.run !== 'install') return { mark: '-', lines: [`not applicable: ${plan.run}  (plan)`] };
			const nc = Array.isArray(plan.corrections) ? plan.corrections.length : 0;
			const nf = Array.isArray(plan.scan) ? plan.scan.length : 0;
			if (nc + nf) return { mark: '-', lines: [`not applicable: ${nc} corrections and ${nf} anti-pattern findings to design from  (plan)`] };
			const b = isObj(plan.baseline) ? plan.baseline : {};
			const base = ps.filter((x) => !/^[ASR]\d/.test(x.id ?? ''));
			const report = plan.mode !== 'full';
			if (base.length) lines.push(`no stated or measured deficit; baseline proposals: ${base.map((x) => `${x.id} (${x.page})`).join(', ')}  (plan)`);
			else if (isStr(b.none_fit) && (report || isStr(b.none_fit_ack))) lines.push(`no stated or measured deficit; no baseline practice fits: ${b.none_fit}${report ? '' : `; ${quote(b.none_fit_ack)} (user)`}`);
			else fail(`no stated or measured deficit, and no baseline-practice proposal: propose the baseline practices that fit, or set baseline.none_fit with the reason and baseline.none_fit_ack with the user's words`);
			if (report) lines.push(`Individual Baseline offer: in the report (${plan.mode})`);
			else if (isStr(b.offer)) lines.push(`Individual Baseline offered: ${quote(b.offer)} (user)`);
			else wait('awaiting: the user\'s answer to the Individual Baseline offer');
			return { mark, head: lines[0], lines: lines.slice(1) };
		}
		case '6.1': {
			if (plan.run === 'uninstall') return { mark: '-', lines: ['not applicable: uninstall removes additions; nothing new has to load  (plan)'] };
			const r = freshLoadLines(plan);
			if (!r.lines.length) return { mark: '-', lines: ['not applicable: no always-loaded change applied  (plan)'] };
			return { mark: r.mark, head: `${r.lines.length} always-loaded targets  $ shrine-check (plan load, fresh-session proofs)`, lines: r.lines };
		}
		case '4.17':
		case '4.18': {
			const sid = id === '4.17' ? 'S1' : 'S2';
			const x = ps.find((p) => p.id === sid);
			if (!x) return plan.run === 'install' && plan.mode === 'full' ? { mark: ' ', lines: [`${sid} not proposed: every full install proposes it`] } : null;
			const pre = isStr(x.preselected) ? `pre-selected [${PICKS.indexOf(x.preselected) + 1}]; ` : sid === 'S2' ? '[not shown pre-selected] ' : '';
			if (sid === 'S2' && !isStr(x.preselected)) mark = ' ';
			if (x.pick == null || !x.decision) wait(`${sid} ${x.title}: ${pre}pick awaiting`);
			else lines.push(`${sid} ${x.title}: ${pre}[${PICKS.indexOf(x.pick) + 1}] ${x.pick}, ${x.decision}, ${quote(x.quote)} (user)`);
			return { mark, lines };
		}
		default:
			return null;
	}
}

function coverageRows(plan, man) {
	const want = manifestPrinciples(man.data);
	const got = new Map((plan.principles ?? []).filter(isObj).map((p) => [p.title, p]));
	const rows = [`${want.length} ratified principles (manifest), ${want.filter((t) => got.has(t)).length} covered in the plan`];
	for (const t of want) {
		const p = got.get(t);
		if (!p) rows.push(`${t}: MISSING`);
		else rows.push(`${t}: ${p.status}${p.status === 'applied' ? ` ${(p.proposals ?? []).join(', ')}` : ''}; reason: ${p.reason ?? '<missing>'}`);
	}
	return rows;
}

// Gate 5 items computed from the record and a post-apply check run.
function gate5Computed(id, ctx) {
	// On an uninstall's Final Gate the record is gone; its backup holds the same entries.
	const rec = ctx.rec ?? ctx.recForFinal;
	const { recordPath, checkRep } = ctx;
	if (!rec) return null;
	const rr = resolver(recordPath);
	const entries = goodEntries(rec.data);
	switch (id) {
		case '5.1':
			return { mark: 'x', lines: [`${resolve(recordPath)} ${h(rec.hash)}  $ shrine-check sha256`] };
		case '5.2': {
			const lines = [];
			let mark = 'x';
			for (const e of entries.filter(applied).filter((x) => isStr(x.backup))) {
				const s = fileSha(rr(e.backup));
				const ok = s != null && s === e.before_sha256;
				if (!ok) mark = ' ';
				lines.push(`${e.id}: ${rr(e.target)} -> ${rr(e.backup)} ${h(s)}${ok ? ' = before' : ` != before ${h(e.before_sha256)}`}  $ shrine-check sha256`);
			}
			if (!lines.length) lines.push('no backups: no existing file was changed  $ shrine-check (record)');
			return { mark, lines };
		}
		case '5.3': {
			const lines = entries.map((e) => `${e.id}: ${e.target}; ${e.status}; before ${h(e.before_sha256)}; after ${recordUpdate(e) ? 'not stored (record update; see 5.1)' : h(e.after_sha256)}  $ shrine-check (record)`);
			return { mark: entries.some((e) => e.status === 'pending') ? ' ' : 'x', lines: lines.length ? lines : ['no entries'] };
		}
		case '5.7': {
			const p = entries.filter((e) => e.status === 'pending').map((e) => e.id);
			return { mark: p.length ? ' ' : 'x', lines: [`${p.length} pending${p.length ? `: ${p.join(', ')}` : ''}  $ shrine-check (record)`] };
		}
		case '5.10': {
			const i = checkRep.lines.findIndex((l) => / page-hashes/.test(l));
			if (i < 0) return { mark: ' ', lines: ['page-hashes did not run: see 5.11'] };
			const block = [checkRep.lines[i]];
			for (let j = i + 1; j < checkRep.lines.length && /^ {2}/.test(checkRep.lines[j]); j++) block.push(checkRep.lines[j].trim());
			return { mark: /^PASS/.test(block[0] ?? '') ? 'x' : ' ', lines: block.map((l) => `${l}`) };
		}
		case '5.11':
			return { mark: checkRep.failed ? ' ' : 'x', head: `${checkRep.result()}  $ ${ctx.checkCmd}`, lines: checkRep.lines };
		default:
			return null;
	}
}

function renderItem(id, title, ctx, gateN) {
	const { plan } = ctx;
	const ev = plan.evidence?.[id];
	const rp = ctx.rp;
	if (plan.run === 'uninstall' && (gateN === 2 || gateN === 3)) return { mark: '-', out: [`[-] ${id} ${title}: not applicable: uninstall path`] };
	if (plan.run === 'uninstall' && gateN === 4 && !UNINSTALL_GATE4.includes(id)) return { mark: '-', out: [`[-] ${id} ${title}: not applicable: uninstall path`] };
	if (ctx.final && plan.run === 'uninstall' && REMOVED_ON_UNINSTALL.includes(id) && !exists(resolve(ctx.recordPath)))
		return { mark: '-', out: [`[-] ${id} ${title}: removed under 6.6/6.7; 6.8 checks them instead`] };
	const comp = gateN === 5 ? gate5Computed(id, ctx) : computed(id, ctx);
	const evr = fromEvidence(ev, rp);
	if (!comp && !evr) {
		const userItem = [...GATES.flatMap((g) => g.items), ...FINAL_ITEMS].find((i) => i[0] === id)?.[2] === 'user';
		if (userItem && plan.mode !== 'full') return { mark: '-', out: [`[-] ${id} ${title}: not applicable: ${plan.mode}`] };
		return { mark: ' ', out: [`[ ] ${id} ${title}: missing from the plan`] };
	}
	let mark;
	let head;
	const subs = [];
	if (evr && comp) {
		// A computed problem outranks the agent's own mark; a computed pass keeps it; a [-] both
		// sides agree on stays [-].
		if (comp.mark === 'x') mark = evr.mark;
		else if (comp.mark === '-' && ['x', '-'].includes(evr.mark)) mark = '-';
		else mark = worst(evr.mark === '-' ? 'x' : evr.mark, comp.mark);
		head = evr.text;
		subs.push(...evr.sub, ...comp.lines.map((l) => `      ${l}`));
	} else if (comp) {
		mark = comp.mark;
		if (isStr(comp.head)) {
			head = comp.head;
			subs.push(...comp.lines.map((l) => `      ${l}`));
		} else if (comp.lines.length === 1) head = comp.lines[0];
		else {
			head = `${comp.lines.length} lines below`;
			subs.push(...comp.lines.map((l) => `      ${l}`));
		}
	} else {
		mark = evr.mark;
		head = evr.text;
		subs.push(...evr.sub);
	}
	return { mark, out: [`${MARKS[mark]} ${id} ${title}: ${head}`, ...subs] };
}

function header(ctx) {
	const { plan } = ctx;
	const t = plan.time ?? {};
	return `Mode: ${plan.mode}    Time: ${t.used ?? '?'} of ${t.agreed ?? '?'} min`;
}

// An uninstall skips Phases 2 and 3: their gates print [-] and need no approval, and Gate 4's
// Approved line carries the Gate 1 approval.
const SKIPPED_ON_UNINSTALL = [2, 3];
const needsApproval = (n, plan) => GATES[n].approval && !(plan.run === 'uninstall' && SKIPPED_ON_UNINSTALL.includes(n));

function approvedLine(gateN, ctx) {
	const { plan } = ctx;
	if (plan.mode === 'report-only') return { ok: true, line: 'Approved: report-only' };
	if (gateN === 0) return { ok: true, line: 'Approved: none needed' };
	let p = gateN - 1;
	if (plan.run === 'uninstall' && gateN === 4) p = 1;
	const prev = GATES[p];
	if (!needsApproval(p, plan)) return { ok: true, line: 'Approved: none needed' };
	const q = plan.approvals?.[String(prev.n)];
	if (!isStr(q)) return { ok: false, line: `Approved: [ ] missing: the user's approval of gate ${prev.n}` };
	const r = renderApproval(prev.n, ctx);
	if (!r.ok) return { ok: false, line: `Approved: [ ] "${q}" (user), but ${r.why}` };
	return { ok: true, line: `Approved: "${q}" (user)${r.what}` };
}

// An approval is of a render. In file delivery the plan names the render file the user opened
// and its sha256, and the file must still equal it. Gate 0 is rendered by hand.
function renderApproval(n, ctx) {
	const { plan } = ctx;
	if (n === 0) return { ok: true, what: '' };
	if (plan.delivery === 'inline') return { ok: true, what: ` for the in-chat render (inline: ${plan.delivery_reason})` };
	const v = plan.renders?.[String(n)];
	if (!isObj(v) || !isStr(v.file)) return { ok: false, why: `plan.renders["${n}"] does not name the render file the user approved` };
	const path = ctx.rp(v.file);
	const actual = path ? fileSha(path) : null;
	if (!HEX64.test(v.sha256 ?? '')) return { ok: false, why: `plan.renders["${n}"].sha256 is not 64 lowercase hex` };
	if (actual == null) return { ok: false, why: `render file ${v.file} is missing` };
	if (actual !== v.sha256) return { ok: false, why: `render file ${v.file} ${h(actual)} != approved ${h(v.sha256)}` };
	return { ok: true, what: ` for render ${path} ${h(actual)}` };
}

function gateBody(gateN, ctx) {
	const g = GATES[gateN];
	const items = g.items.map(([id, title]) => renderItem(id, title, ctx, gateN));
	const ap = approvedLine(gateN, ctx);
	const marks = items.map((i) => i.mark);
	// Gate 0 is printed by hand, so its items must reach the plan before Gate 1 renders.
	const carried = [];
	if (gateN >= 1) {
		const missing = GATES[0].items.filter(([id, title]) => renderItem(id, title, ctx, 0).out[0].endsWith('missing from the plan')).map(([id]) => id);
		if (missing.length) carried.push(`[ ] Gate 0 in the plan: ${missing.join(', ')} missing; add Gate 0's evidence to the plan before Gate 1`);
	}
	const approval = needsApproval(gateN, ctx.plan);
	let status = 'PASS';
	if (!ap.ok || marks.includes(' ') || carried.length) status = 'BLOCKED';
	else if (marks.includes('wait')) status = 'WAITING FOR APPROVAL';
	else if (approval && ctx.plan.mode === 'full' && !isStr(ctx.plan.approvals?.[String(gateN)])) status = 'WAITING FOR APPROVAL';
	const next =
		status === 'BLOCKED'
			? 'Next: fix each [ ] item, ask the user, or abort. Approval needed: no.'
			: `Next: ${g.next}. Approval needed: ${approval && ctx.plan.mode === 'full' ? `yes. Reply "approve gate ${gateN}"` : 'no'}.`;
	return { status, items, lines: [`GATE ${gateN} of 6: ${g.name}: ${status}`, ap.line, header(ctx), ...carried, ...items.flatMap((i) => i.out), next] };
}

function restoreLines(recData, recordPath) {
	const rr = resolver(recordPath);
	const groups = byTarget(goodEntries(recData), rr);
	const out = [];
	for (const [target, list] of groups) {
		for (const e of list) out.push(`${e.id}: ${e.undo}`);
		const first = list[0];
		if (isStr(first.backup))
			out.push(`whole-file restore of ${target}: from ${rr(first.backup)}, only when its current sha256 equals ${h(first.before_sha256)} (first before) or ${h(list[list.length - 1].after_sha256)} (last after)`);
	}
	for (const e of goodEntries(recData).filter(recordUpdate).filter(applied))
		out.push(`${e.id} (record update): ${e.undo}; whole-record restore from ${isStr(e.backup) ? rr(e.backup) : '<no backup>'}, whose sha256 is ${h(e.before_sha256)}`);
	return out.length ? out : ['no changes to restore'];
}

function reportLines(plan, recData, recordPath, man, un = {}) {
	const entries = goodEntries(recData);
	const ids = new Set(proposalsOf(plan).map((x) => x.id));
	// Changed lists this run's changes; a re-run's record also holds earlier runs' entries.
	const done = entries.filter((e) => e.status === 'done' && (!ids.size || ids.has(e.id)));
	const skipped = [...entries.filter((e) => e.status === 'rejected').map((e) => e.id), ...proposalsOf(plan).filter((x) => x.decision === 'rejected' && !entries.some((e) => e.id === x.id)).map((x) => x.id)];
	const rr = recordPath ? resolver(recordPath) : (p) => p;
	const backups = entries.filter((e) => isStr(e.backup)).map((e) => rr(e.backup));
	const base = isStr(man?.data?.checker?.url) ? man.data.checker.url.replace(/shrine-check\.mjs$/, '') : SITE;
	const msrc = `${base}shrine-manifest.json`;
	const rpt = isObj(plan.report) ? plan.report : {};
	const why = isObj(rpt.skipped_why) ? rpt.skipped_why : {};
	const pages = new Map((man?.data?.pages ?? []).filter(isObj).map((p) => [p.title, p]));
	const tops = (Array.isArray(rpt.top_practices) ? rpt.top_practices : []).filter(isObj);
	const top = tops.length
		? tops.map((t, i) => `${i + 1}. ${t.practice} (${pages.get(t.page)?.url ?? (man ? `<"${t.page}" has no url in the manifest>` : `"${t.page}"`)})`).join(' ')
		: '<missing: plan.report.top_practices>';
	if (un.uninstall)
		// The record and SHRINE's additions are gone: no undo, rerun, or handoff line applies.
		return [
			`Removed: ${done.map((e) => `${e.id} ${e.target}`).join('; ') || 'nothing'}`,
			`Skipped: ${skipped.map((id) => `${id} (${why[id] ?? '<missing: plan.report.skipped_why>'})`).join('; ') || 'none'}`,
			`Paste-ready: ${isStr(rpt.paste_ready) ? rpt.paste_ready : '<missing: plan.report.paste_ready>'}`,
			`Record: removed (6.6): ${recordPath ? resolve(recordPath) : '<record>'}`,
			un.backupsDeleted ? 'Backups: deleted on your approval (6.7)' : `Backups: kept: ${backups.join(', ') || 'none'} (restore steps in the README beside them)`,
			`Top practices: ${top}`,
		];
	return [
		`Changed: ${done.map((e) => `${e.id} ${e.target}`).join('; ') || 'nothing'}`,
		`Skipped: ${skipped.map((id) => `${id} (${why[id] ?? '<missing: plan.report.skipped_why>'})`).join('; ') || 'none'}`,
		`Paste-ready: ${isStr(rpt.paste_ready) ? rpt.paste_ready : '<missing: plan.report.paste_ready>'}`,
		`Backups: ${backups.join(', ') || 'none'}`,
		'Undo: each step in 6.4',
		...(recordPath
			? [
					`Rerun the checker: download ${base}shrine-check.mjs, compare its sha256 with the manifest's checker.sha256${man?.data?.checker?.sha256 ? ` (${h(man.data.checker.sha256)})` : ''}, then run:`,
					`  node shrine-check.mjs --record ${resolve(recordPath)} --manifest ${msrc} --post-apply`,
				]
			: ['Rerun the checker: no record was written, so there is nothing to check']),
		`Top practices: ${top}`,
		`Handoff: say "SHRINE refresh" when SHRINE moves; re-run when one correction tag leads or a measured signal moves (Individual Baseline: ${base}stack/evaluation/#individual-baseline)`,
	];
}

// The report is complete when the plan fills every line the checker cannot derive.
function reportProblems(plan, recData, man, un) {
	const lines = reportLines(plan, recData ?? { entries: [] }, null, man, un);
	return lines.filter((l) => /<missing|has no url in the manifest/.test(l)).map((l) => `report line not filled: ${l}`);
}

function renderFinal(ctx, opts) {
	const { plan } = ctx;
	const all = [];
	const body = [];
	for (const g of GATES) {
		body.push(`-- Gate ${g.n}: ${g.name}`);
		for (const [id, title] of g.items) {
			const r = renderItem(id, title, ctx, g.n);
			all.push([id, r.mark]);
			body.push(...r.out);
		}
	}
	body.push('-- Phase 6: Verify, Self-Audit, Hand Off');
	const finalItem = (id, title, mark, lines) => {
		all.push([id, mark]);
		body.push(`${MARKS[mark]} ${id} ${title}: ${lines[0]}`, ...lines.slice(1).map((l) => `      ${l}`));
	};
	for (const id of ['6.1', '6.2']) {
		const r = renderItem(id, FINAL_ITEMS.find((i) => i[0] === id)[1], ctx, 6);
		all.push([id, r.mark]);
		body.push(...r.out);
	}
	const recData = ctx.recForFinal?.data;
	const checkRep = ctx.checkRep;
	const markOf = (id) => all.find((a) => a[0] === id)?.[1];
	// 6.4, 6.6, 6.7, and 6.8 feed the map, so take their marks before printing 6.3.
	const r66 = plan.run === 'uninstall' ? renderItem('6.6', 'Record removal', ctx, 6) : { mark: '-', out: ['[-] 6.6 Record removal: not applicable: not an uninstall'] };
	const r67 = plan.run === 'uninstall' ? renderItem('6.7', 'Backup deletion', ctx, 6) : { mark: '-', out: ['[-] 6.7 Backup deletion: not applicable: not an uninstall'] };
	const r64 = recData ? null : renderItem('6.4', 'Restore instructions', ctx, 6);
	const r68 = checkRep ? null : renderItem('6.8', 'Checker, final run', ctx, 6);
	const marks = [['6.4', r64 ? r64.mark : 'x'], ['6.6', r66.mark], ['6.7', r67.mark], ['6.8', r68 ? r68.mark : checkRep.failed ? ' ' : 'x']];
	const inv = INVARIANTS.map(([name, ids]) => {
		const m = (id) => markOf(id) ?? marks.find((x) => x[0] === id)?.[1] ?? ' ';
		return { ok: ids.every((id) => ['x', '-'].includes(m(id))), line: `${name}: ${ids.map((id) => `${id}${MARKS[m(id)]}`).join(' ')}` };
	});
	finalItem('6.3', 'Invariant Map', inv.every((i) => i.ok) ? 'x' : ' ', [`${inv.filter((i) => i.ok).length} of ${INVARIANTS.length} invariants with every item [x] or [-]  $ shrine-check (marks in this gate)`, ...inv.map((i) => i.line)]);
	if (r64) body.push(...r64.out);
	else finalItem('6.4', 'Restore instructions', 'x', ['from the record  $ shrine-check (record)', ...restoreLines(recData, opts.record)]);
	const un = { uninstall: plan.run === 'uninstall' && opts.uninstall, backupsDeleted: opts.backupsDeleted };
	const rprobs = reportProblems(plan, recData, ctx.man, un);
	finalItem('6.5', 'Report', rprobs.length ? ' ' : 'x', [
		rprobs.length ? `fill plan.report, then render again: ${rprobs.length} lines not filled` : 'rendered from the record and plan.report; show it with --render report after this gate  $ shrine-check (record, plan report)',
		...reportLines(plan, recData ?? { entries: [] }, opts.record, ctx.man, un),
	]);
	body.push(...r66.out, ...r67.out);
	if (r68) body.push(...r68.out);
	else finalItem('6.8', 'Checker, final run', checkRep.failed ? ' ' : 'x', [checkRep.result(), ...checkRep.lines, `$ ${ctx.checkCmd}`]);
	all.push(...marks);
	const blocked = all.some(([, m]) => m === ' ' || m === 'wait');
	let ap = 'Approved: none needed';
	let apOk = true;
	if (plan.mode === 'report-only') ap = 'Approved: report-only';
	else if (plan.run === 'uninstall') {
		const a = plan.approvals?.['6.6'];
		const b = plan.approvals?.['6.7'];
		apOk = isStr(a) && isStr(b);
		ap = apOk ? `Approved: "${a}" (6.6), "${b}" (6.7) (user)` : 'Approved: [ ] missing: the user\'s words for 6.6 and 6.7';
	}
	const status = blocked || !apOk ? 'BLOCKED' : 'PASS';
	return { status, marks: all.map(([, m]) => m), lines: [`FINAL GATE: ${status}`, ap, header(ctx), ...body, `FINAL GATE is ${status}: ${status === 'PASS' ? 'every item is [x] or [-] with a reason' : 'fix each [ ] item, or report it as a gap'}.`] };
}

function refreshLines(rec, man, promptFile) {
	const r = rec.data;
	const m = man.data;
	const out = [
		`recorded prompt version ${r.prompt?.version}, live ${m.prompt?.version}${m.prompt?.version > r.prompt?.version ? ': a newer prompt exists' : ''}`,
		`recorded prompt ${h(r.prompt?.sha256)}, live ${h(m.prompt?.sha256)}`,
		`recorded commit ${r.commit}, live ${m.commit}${r.commit === m.commit ? ': SHRINE has not moved' : ': SHRINE moved'}`,
	];
	let ok = true;
	if (promptFile) {
		const s = fileSha(promptFile);
		ok = s === m.prompt?.sha256;
		out.push(`fetched prompt ${promptFile} ${h(s)} ${ok ? '= manifest prompt.sha256' : `!= manifest prompt.sha256: stop, report, and follow nothing`}`);
	}
	const live = new Map((m.pages ?? []).map((p) => [p.title, p.sha256]));
	const changed = (r.pages ?? []).filter(isObj).filter((p) => live.get(p.title) !== p.sha256);
	out.push(`${changed.length} recorded pages changed`);
	for (const p of changed) out.push(`  "${p.title}" recorded ${h(p.sha256)}, live ${live.has(p.title) ? h(live.get(p.title)) : 'removed'}`);
	if (r.commit !== m.commit) out.push(`compare: https://github.com/stablekernel/SHRINE/compare/${r.commit}...${m.commit}`);
	return { ok, lines: out };
}

// The pinned commit, prompt, and page hashes in full, for text that must carry them (S1 and S2
// without a record). Prose never retypes a hash; it pastes this render or points to its file.
function pinLines(plan, man) {
	const m = man.data;
	const titles = (plan.pages ?? []).filter(isObj).map((p) => p.title);
	const mp = new Map((m.pages ?? []).filter(isObj).map((p) => [p.title, p.sha256]));
	return [
		`commit ${m.commit}`,
		`prompt version ${m.prompt?.version}; prompt ${h(m.prompt?.sha256)}`,
		`checker ${h(m.checker?.sha256)}`,
		`${titles.length} pages read`,
		...titles.map((t) => `  "${t}" ${mp.has(t) ? h(mp.get(t)) : 'not in manifest'}`),
	];
}

// ---------- render output: in full, or to a file with a short block ----------

// Folders the checker must never write into: every scope root, the project root, and the
// record's scope root. Render files belong in the run's temporary folder.
function forbiddenRoots(plan, recordPath) {
	const roots = [];
	if (isObj(plan?.scope) && Array.isArray(plan.scope.roots)) roots.push(...plan.scope.roots.filter(isStr).map(expandHome));
	if (isStr(plan?.project_root)) roots.push(expandHome(plan.project_root));
	if (isStr(recordPath)) roots.push(dirname(dirname(resolve(recordPath))));
	return roots.map((r) => realish(r));
}

function writeRender(kind, text, opts, plan) {
	const dir = realish(resolve(opts.out));
	let isDir = false;
	try {
		isDir = statSync(dir).isDirectory();
	} catch {}
	if (!isDir) throw new Error(`--out ${opts.out} is not an existing folder: create the run's temporary folder first`);
	for (const r of forbiddenRoots(plan, opts.record))
		if (dir === r || dir.startsWith(r.endsWith(sep) ? r : r + sep)) throw new Error(`--out ${dir} lies inside ${r}: render files go in the run's temporary folder, outside every scope`);
	const slug = kind.replace(/\s+/g, '-');
	const taken = new Set(readdirSync(dir));
	for (let n = 1; ; n++) {
		const name = `${slug}-${n}.txt`;
		const path = join(dir, name);
		if (!taken.has(name)) {
			// wx: never overwrite; a file that appeared since the listing makes this throw.
			writeFileSync(path, text, { flag: 'wx' });
			return path;
		}
		if (fileSha(path) === sha(text)) return path;
	}
}

// Print a render in full, or write it to a file and print only the short block the agent pastes.
function emit(kind, body, opts, plan, summary) {
	const text = renderText(kind, body);
	if (!opts.out) {
		process.stdout.write(text);
		return;
	}
	const path = writeRender(kind, text, opts, plan);
	const short = [
		`--- shrine-check ${VERSION} short ${kind} (paste verbatim; the full render is in the file) ---`,
		...summary,
		`render file: ${path}`,
		`render sha256:${sha(text)}`,
		`--- end short ${kind} ---`,
	];
	console.log(short.join('\n'));
}

const markCounts = (marks) => {
	const n = (m) => marks.filter((x) => x === m).length;
	return `counts: ${n('x')} [x], ${n('-')} [-], ${n(' ')} [ ], ${n('wait')} awaiting`;
};

// ---------- main ----------

async function render(opts) {
	if (opts.render === 'refresh') {
		const man = await loadManifest(opts.manifest);
		const rec = loadJSON(opts.record);
		const r = refreshLines(rec, man, opts.prompt);
		emit('refresh', r.lines, opts, null, [`REFRESH: ${r.ok ? 'prompt verified' : 'PROMPT MISMATCH: follow nothing'}`, r.lines[2], r.lines.find((l) => /recorded pages changed$/.test(l))]);
		return r.ok ? 0 : 1;
	}
	const planFile = loadJSON(opts.plan);
	const plan = planFile.data;
	const shape = planShape(plan);
	if (shape.length) {
		console.error(`shrine-check: plan ${opts.plan} is malformed:\n${shape.map((s) => `  - ${s}`).join('\n')}`);
		return 2;
	}
	const ctx = { plan, rp: planResolver(plan), recordPath: opts.record };
	if (opts.manifest) ctx.man = await loadManifest(opts.manifest);
	if (opts.render === 'menus') {
		const body = menuBody(plan);
		const ps = proposalsOf(plan);
		emit('menus', body, opts, plan, [`MENUS: ${ps.length} proposals (${ps.map((x) => x.id).join(', ')}), 4 options each`, 'Reply with a pick per proposal: 1, 2, 3, or 4, with edits, if any.']);
		return 0;
	}
	if (opts.render === 'coverage') {
		const p = coverageProblems(plan, ctx.man.data);
		const rows = coverageRows(plan, ctx.man);
		emit('coverage', [...rows, ...p.map((x) => `FAIL ${x}`)], opts, plan, [`COVERAGE: ${p.length ? 'FAIL' : 'PASS'}; ${rows[0]}`]);
		return p.length ? 1 : 0;
	}
	if (opts.render === 'pin') {
		const lines = pinLines(plan, ctx.man);
		emit('pin', lines, opts, plan, [`PIN: ${lines[0]}; ${lines[3]}`]);
		return 0;
	}
	if (opts.render === 'report') {
		const recData = opts.uninstall ? loadJSON(opts.recordBackup).data : opts.record ? loadJSON(opts.record).data : { entries: [] };
		const un = { uninstall: opts.uninstall, backupsDeleted: opts.backupsDeleted };
		const lines = reportLines(plan, recData, opts.record, ctx.man, un);
		const p = reportProblems(plan, recData, ctx.man, un);
		emit('report', lines, opts, plan, [`REPORT: ${p.length ? `${p.length} lines not filled` : 'complete'}; ${lines.length} lines`]);
		return p.length ? 1 : 0;
	}
	const rep = new Report();
	const postApplyCmd = `node shrine-check.mjs --record ${opts.record} --manifest ${opts.manifest} --plan ${opts.plan} --post-apply`;
	if (opts.render === 'final' && opts.uninstall) {
		// After 6.6 the record is gone: check its absence and the kept or deleted backups.
		ctx.recForFinal = uninstallChecks(rep, opts, plan);
		ctx.checkCmd = `node shrine-check.mjs --uninstall --record ${opts.record} --record-backup ${opts.recordBackup}${opts.backupsDeleted ? ' --backups-deleted' : ''} --plan ${opts.plan}`;
	} else if (opts.record && (opts.render === 'final' || opts.gate === 5)) {
		// Gate 5 and an install's Final Gate: the record exists; run every post-apply check now.
		ctx.rec = loadJSON(opts.record);
		ctx.recForFinal = ctx.rec;
		installChecks(rep, ctx.rec, ctx.man, { ...opts, postApply: true }, plan);
		ctx.checkCmd = postApplyCmd;
	}
	// No record (advice-only, paste-ready, or report-only): no checks run; those items come from the plan.
	ctx.checkRep = opts.record ? rep : null;
	if (opts.render === 'final') {
		ctx.final = true;
		const f = renderFinal(ctx, opts);
		const blocked = f.lines.filter((l) => /^\[ \] /.test(l)).map((l) => l.split(':')[0].slice(4));
		emit('final', f.lines, opts, plan, [`FINAL GATE: ${f.status}`, markCounts(f.marks), ...(blocked.length ? [`open items: ${blocked.join(', ')}`] : [])]);
		return f.status === 'PASS' ? 0 : 1;
	}
	const g = gateBody(opts.gate, ctx);
	const open = g.lines.filter((l) => /^\[ \] /.test(l)).map((l) => l.split(':')[0].slice(4));
	emit(`gate ${opts.gate}`, g.lines, opts, plan, [g.lines[0], g.lines[1], markCounts(g.items.map((i) => i.mark)), ...(open.length ? [`open items: ${open.join(', ')}`] : []), g.lines[g.lines.length - 1]]);
	return g.status === 'BLOCKED' ? 1 : 0;
}

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`shrine-check: ${err.message}\n${USAGE}`);
		return 2;
	}
	if (opts.render) {
		try {
			return await render(opts);
		} catch (err) {
			console.error(`shrine-check: ${err.message}`);
			return 2;
		}
	}
	const rep = new Report();
	rep.info(`shrine-check ${VERSION} (changes nothing) mode: ${opts.uninstall ? 'uninstall' : opts.postApply ? 'post-apply' : 'check'}`);
	let plan;
	try {
		if (opts.plan) plan = loadJSON(opts.plan).data;
	} catch (err) {
		console.error(`shrine-check: ${err.message}`);
		return 2;
	}
	if (opts.uninstall) uninstallChecks(rep, opts, plan);
	else {
		let rec;
		let man;
		try {
			man = await loadManifest(opts.manifest);
			rec = loadJSON(opts.record);
		} catch (err) {
			console.error(`shrine-check: ${err.message}`);
			return 2;
		}
		rep.info(`record: ${resolve(opts.record)} ${h(rec.hash)}`);
		rep.info(`manifest: ${opts.manifest} ${h(man.hash)}`);
		installChecks(rep, rec, man, opts, plan);
	}
	rep.info(rep.result());
	console.log(rep.lines.join('\n'));
	return rep.failed ? 1 : 0;
}

process.exitCode = await main();
