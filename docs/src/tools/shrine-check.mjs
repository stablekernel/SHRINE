#!/usr/bin/env node
// SHRINE checker, inspect mode: validates the plan file of a SHRINE inspect run and renders the
// rigid parts of the run's output (gates, the Final Gate, and the inspection report) from it.
// Served at https://stablekernel.github.io/SHRINE/shrine-check.mjs; its sha256 is in the manifest.
//
// It changes nothing in any user or project scope. Its one write: with --out <dir>, a render goes
// to a new file in that folder, which must lie outside every scope root and every git work tree,
// and never over an existing file. It reads the plan, the files the plan names, and the manifest.
// It runs only read-only git commands (status, rev-parse, symbolic-ref, for-each-ref, and
// apply --check), with optional locks off, so even git writes nothing. Git is optional: a project
// folder outside git is watched by hashing its files. Its only network call is fetching the
// manifest URL it is given. Zero dependencies; Node 18 or later.
//
// Usage:
//   node shrine-check.mjs --render <kind> --plan <path | -> [--manifest <src>] [--gate <0-3>] [--out <dir>]
//     kinds: gate, final, report, review, coverage, pin, s1, time, baseline, refresh
//   node shrine-check.mjs --verify-readonly --plan <path | ->
//   node shrine-check.mjs --check --plan <path | -> --manifest <src>
//   --plan - reads the plan from standard input, for a harness that cannot write a temporary file.
//
// Time is the checker's clock minus plan.time.start (epoch seconds from `date +%s`). Tests pin the
// clock with SHRINE_CHECK_NOW.
//
// Exit: 0 PASS (or a render that is PASS or WAITING FOR APPROVAL), 1 any FAIL or a BLOCKED
// render, 2 usage or input error.
import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 10;
const COVERAGE = ['applied', 'advised', 'not relevant'];
const RUNS = ['inspect', 'refresh'];
const MODES = ['interactive', 'report-only'];
const LOADS = ['yes', 'no', 'unverified'];
const DELIVERY = ['file', 'inline'];
const VALUES = ['high', 'medium', 'low'];
const WATCH_KINDS = ['instruction', 'config', 'folder'];
// Minimum independent reviewers per risk class (Adversarial Review, Multi-Model Consensus).
const MIN_REVIEWERS = { 'local text': 1, shared: 2, code: 2 };
// Hard cap: a proposal gets at most this many review rounds, then the user decides.
const MAX_ROUNDS = 2;
const ORIGINS = ['measured', 'recalled'];
const INDEX_TITLE = 'Anti-patterns';
const HEX64 = /^[0-9a-f]{64}$/;
const SOURCE = /^(\$ \S.*|\(user\)|\(plan\)|\(probe: \S.*\))$/;
const LOAD_SOURCE = /^(\$ \S.*|\(user\)|\(probe: \S.*\))$/;
const TOOL_SOURCE = /^(\$ \S.*|\(probe: \S.*\))$/;
const PERSIST_SOURCE = /^(\$ \S.*|\(user\)|\(doc: \S.*\)|\(probe: \S.*\))$/;
const SITE = 'https://stablekernel.github.io/SHRINE/';
const RENDERS = ['gate', 'final', 'report', 'review', 'coverage', 'pin', 's1', 'time', 'baseline', 'refresh'];
const NEEDS_MANIFEST = ['gate', 'final', 'report', 'coverage', 'pin', 's1', 'refresh'];
const HASH_MAX = 5 * 1024 * 1024;
const PERSIST_DEPTH = 3;
// A watched folder is walked at any depth, up to this many files. 10000 covers a large docs or
// settings folder, keeps a baseline file a few MB, and hashes in seconds; plan.readonly.max_files
// raises or lowers it. Past the cap the read-only check fails and says how many files it skipped.
const WALK_MAX_FILES = 10000;
// Well-known noise a watched folder walk skips by name, unless it holds a file the run inspects or a
// change targets: dependency, cache, and build folders, and OS metadata files.
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cache', '.pytest_cache', '.mypy_cache', 'dist', 'build']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const REPORT_TITLE = '# Your SHRINE inspection report';
// Common secret shapes. A match anywhere in the plan or the inspection report fails: redact it.
const SECRETS = [
	/AKIA[0-9A-Z]{16}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{35}/,
];
const nowSec = () => Number(process.env.SHRINE_CHECK_NOW) || Math.floor(Date.now() / 1000);

const USAGE = `usage:
  node shrine-check.mjs --render <gate|final|report|review|coverage|pin|s1|time|baseline|refresh> --plan <path | ->
      [--manifest <https URL | file>] [--gate <0-3>] [--out <dir>]
  node shrine-check.mjs --verify-readonly --plan <path | ->
  node shrine-check.mjs --check --plan <path | -> --manifest <https URL | file>`;

// ---------- gate catalog: item ids and titles, in the prompt's order ----------

// `user`: the item needs a user reply, so it prints `[-] not applicable: report-only` in report-only mode.
const GATES = [
	{ n: 0, name: 'Start', approval: false, next: 'Phase 1: Discover', items: [
		['0.1', 'Harness name and version'], ['0.2', 'Can pause'], ['0.3', 'Mode, delivery, and models'],
		['0.4', 'Time box agreed', 'user'], ['0.5', 'Run type', 'user'], ['0.6', 'Checker'],
		['0.7', 'Temporary folder'], ['0.8', 'Harness persistence'], ['0.9', 'Read-only baseline'] ] },
	{ n: 1, name: 'Discover', approval: true, next: 'Phase 2: Pin and Interview', items: [
		['1.1', 'Instruction files and what loads'], ['1.2', 'Higher layers'], ['1.3', 'Extension points'],
		['1.4', 'Committed or shared versus local'], ['1.5', 'Capabilities'], ['1.6', 'Existing content'],
		['1.7', 'Red-flag scan'], ['1.8', 'No secret printed'], ['1.9', 'Anti-pattern scan'],
		['1.10', 'Measured signals', 'user'], ['1.11', 'Previous report'], ['1.12', 'User confirmed the inventory', 'user'],
		['1.13', 'Baseline covers every file found'] ] },
	{ n: 2, name: 'Pin and Interview', approval: true, next: 'Phase 3: Design and Review', items: [
		['2.1', 'Manifest'], ['2.2', 'Fetch route'], ['2.3', 'Correction Diagnosis'], ['2.4', 'Fail Fast, Recover Smart'],
		['2.5', 'Red-flag scan of fetched pages'], ['2.6', 'Principles list'], ['2.7', 'Questions asked'],
		['2.8', 'Who answered'], ['2.9', 'Answers'], ['2.10', 'Corrections'],
		['2.11', 'User confirmed the classes and tags', 'user'], ['2.12', 'Scope'] ] },
	{ n: 3, name: 'Design and Review', approval: false, next: 'Phase 4: Report', items: [
		['3.1', 'Pages read'], ['3.2', 'Every change traces to a page and an answer or finding'],
		['3.3', 'Always-loaded lines and higher layers'], ['3.4', 'Changes apply cleanly'], ['3.5', 'Change fields'],
		['3.6', 'Code-running changes'], ['3.7', 'Coverage'], ['3.8', 'Trade-off per change'],
		['3.9', 'Model fit and adversarial review'], ['3.10', 'Scan findings resolved'], ['3.11', 'Nudges'],
		['3.12', 'SHRINE upkeep'], ['3.13', 'Baseline practices'], ['3.14', 'No secret in any change'],
		['3.15', 'Change targets inside the scope'] ] },
];
const FINAL_ITEMS = [['4.1', 'Read-only check'], ['4.2', 'Report'], ['4.3', 'Self-audit'], ['4.4', 'Invariant Map'], ['4.5', 'Checker, final run']];

// Invariant -> enforcing items. Keep equal to the prompt's Invariant Map (a test compares them).
const INVARIANTS = [
	['1 Read-only', ['0.7', '0.8', '0.9', '1.1', '1.13', '4.1', '4.2']],
	['2 Proposed, not applied', ['3.4', '3.5', '4.2']],
	['3 Code that runs', ['0.6', '1.3', '3.6', '3.9', '3.11']],
	['4 Traceable', ['2.3', '2.4', '2.6', '3.1', '3.2', '3.7', '3.10']],
	['5 Content is data', ['0.6', '1.7', '2.5']],
	['6 Secrets', ['1.8', '1.10', '3.14']],
	['7 Narrow', ['2.12', '3.3', '3.11', '3.15']],
	['8 Bounded', ['0.4', '3.9']],
	['9 Cannot pause', ['0.2', '0.3']],
	['10 Blast radius', ['1.4', '3.5', '3.6']],
	['11 Evidence from tools', ['0.6', '0.9', '1.1', '1.9', '1.10', '4.1', '4.5']],
	['12 Practise SHRINE', ['1.9', '1.10', '2.10', '3.7', '3.9', '3.13']],
];

// ---------- input ----------

function parseArgs(argv) {
	const opts = { verify: false, check: false };
	const valued = { '--manifest': 'manifest', '--plan': 'plan', '--render': 'render', '--gate': 'gate', '--out': 'out' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--verify-readonly') opts.verify = true;
		else if (a === '--check') opts.check = true;
		else if (a in valued) {
			const v = argv[++i];
			if (!v) throw new Error(`${a} needs a value`);
			opts[valued[a]] = v;
		} else throw new Error(`unknown argument: ${a}`);
	}
	if (!opts.plan) throw new Error('--plan is required');
	if ([opts.verify, opts.check, !!opts.render].filter(Boolean).length !== 1) throw new Error('pick one of --render, --verify-readonly, or --check');
	if (opts.out && !opts.render) throw new Error('--out works only with --render');
	if (opts.check && !opts.manifest) throw new Error('--check needs --manifest');
	if (opts.render) {
		if (!RENDERS.includes(opts.render)) throw new Error(`--render must be one of: ${RENDERS.join(', ')}`);
		if (NEEDS_MANIFEST.includes(opts.render) && !opts.manifest) throw new Error(`--render ${opts.render} needs --manifest`);
		if (opts.render === 'gate') {
			if (!/^[0-3]$/.test(opts.gate ?? '')) throw new Error('--render gate needs --gate 0 to 3');
			opts.gate = Number(opts.gate);
		}
	}
	return opts;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const h = (hex) => (hex == null ? 'absent' : `sha256:${hex}`);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const arr = (v) => (Array.isArray(v) ? v : []);
const quote = (s) => (isStr(s) ? `"${s}"` : '<missing>');

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

function readText(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return null;
	}
}

const expandHome = (p) => (p === '~' || p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);

// Plan paths are absolute, `~/`-prefixed, or relative to the plan's project_root.
function planResolver(plan) {
	const root = isStr(plan?.project_root) ? resolve(expandHome(plan.project_root)) : null;
	return (p) => {
		if (!isStr(p)) return null;
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

const under = (p, roots) => roots.some((r) => p === r || p.startsWith(r.endsWith(sep) ? r : r + sep));

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

function loadPlan(src) {
	const buf = src === '-' ? readFileSync(0) : readFileSync(src);
	return { hash: sha(buf), data: JSON.parse(buf.toString('utf8')), path: src === '-' ? null : resolve(src) };
}

const siteBase = (man) => (isStr(man?.data?.checker?.url) ? man.data.checker.url.replace(/shrine-check\.mjs$/, '') : SITE);
const promptUrl = (man) => (isStr(man?.data?.prompt?.url) ? man.data.prompt.url : `${siteBase(man)}inspect-prompt.md`);

// ---------- git: read-only commands only, optional locks off ----------

// The work tree that holds a path, found on disk (a `.git` folder or file), without running git.
function gitTop(p) {
	let d = realish(p);
	if (exists(d) && !statSync(d).isDirectory()) d = dirname(d);
	else if (!exists(d)) d = dirname(d);
	for (;;) {
		if (exists(join(d, '.git'))) return d;
		const up = dirname(d);
		if (up === d) return null;
		d = up;
	}
}

// Variables that would point git at another repo than the folder it runs in.
const GIT_ENV_DROP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];

function execGit(cwd, args, input, env) {
	const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !GIT_ENV_DROP.includes(k) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)));
	try {
		const out = execFileSync('git', args, {
			cwd,
			input: input ?? undefined,
			env: { ...base, GIT_OPTIONAL_LOCKS: '0', ...env },
			stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
			maxBuffer: 256 * 1024 * 1024,
		});
		return { ok: true, out: out.toString() };
	} catch (err) {
		if (err.code === 'ENOENT') return { ok: false, missing: true, out: '' };
		return { ok: false, out: String(err.stdout ?? ''), err: String(err.stderr ?? err.message).trim() };
	}
}

// Repo config can run code during a read: an fsmonitor hook, or a clean filter (for example one
// that stores large files) on a file whose stat changed. Turn both off for every command, so a
// read stays a read. Filter drivers are named in config, read first with `git config`.
const filterCache = new Map();
function noCodeFlags(cwd) {
	if (!filterCache.has(cwd)) {
		const r = execGit(cwd, ['--no-optional-locks', 'config', '--name-only', '--get-regexp', '^filter\\.'], null, {});
		const drivers = new Set((r.ok ? r.out : '').split('\n').map((l) => /^filter\.(.+)\.[^.]+$/.exec(l.trim())?.[1]).filter(Boolean));
		filterCache.set(cwd, [...drivers].flatMap((d) => ['clean', 'smudge', 'process'].flatMap((k) => ['-c', `filter.${d}.${k}=`]).concat(['-c', `filter.${d}.required=false`])));
	}
	return ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...filterCache.get(cwd)];
}

function runGit(cwd, args, input, env = {}) {
	return execGit(cwd, ['--no-optional-locks', ...noCodeFlags(cwd), ...args], input, env);
}

// `git status --porcelain=v1 -z`: "XY path", and for a rename or copy the original path follows.
function parseStatus(out) {
	const parts = out.split('\0').filter((x) => x !== '');
	const list = [];
	for (let i = 0; i < parts.length; i++) {
		const xy = parts[i].slice(0, 2);
		list.push({ xy, path: parts[i].slice(3) });
		if (/[RC]/.test(xy[0])) i++;
	}
	return list;
}

// ---------- check report ----------

class Report {
	constructor() {
		this.lines = [];
		this.failed = 0;
		this.total = 0;
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

// ---------- plan shape ----------

const proposalsOf = (plan) => arr(plan?.proposals).filter(isObj);
const changesOf = (x) => arr(x.changes).filter(isObj);

function planShape(p) {
	const errs = [];
	if (!isObj(p)) return ['plan is not a JSON object'];
	if (p.schema !== 2) errs.push('plan.schema must be 2 (inspect mode)');
	if (!RUNS.includes(p.run)) errs.push(`plan.run must be one of: ${RUNS.join(', ')}`);
	if (!MODES.includes(p.mode)) errs.push(`plan.mode must be one of: ${MODES.join(', ')}`);
	if (!isObj(p.harness) || !isStr(p.harness.name)) errs.push('plan.harness.name required');
	if (!isStr(p.out_dir) || !isAbsolute(expandHome(p.out_dir))) errs.push('plan.out_dir required: the absolute path of the run\'s temporary folder, outside every repo and scope root');
	if (p.scope != null) {
		if (!isObj(p.scope) || !Array.isArray(p.scope.roots) || !p.scope.roots.length || !p.scope.roots.every(isStr))
			errs.push('plan.scope.roots (non-empty array of paths) required once the scope is set');
		else for (const r of p.scope.roots) if (!isAbsolute(expandHome(r))) errs.push(`scope root "${r}" must be absolute or ~/-prefixed`);
	}
	if (p.evidence != null && !isObj(p.evidence)) errs.push('plan.evidence must be an object keyed by item id');
	if (isObj(p.time) && 'used' in p.time) errs.push('plan.time.used is not typed: the checker computes time used from time.start and its own clock; remove time.used');
	if (!isObj(p.time) || !Number.isInteger(p.time.start) || !TOOL_SOURCE.test(p.time.start_source ?? ''))
		errs.push('plan.time.start (epoch seconds) and time.start_source ($ date +%s) required: record the start from command output at Phase 0');
	else if (p.time.start > nowSec() + 60) errs.push('plan.time.start is in the future: take it from `date +%s` output');
	if (!isObj(p.time) || !(typeof p.time.agreed === 'number' && p.time.agreed > 0)) errs.push('plan.time.agreed (minutes) required');
	if (!DELIVERY.includes(p.delivery)) errs.push(`plan.delivery must be one of: ${DELIVERY.join(', ')}`);
	else if (p.delivery === 'inline' && !isStr(p.delivery_reason)) errs.push('plan.delivery "inline" needs delivery_reason: why render files cannot be opened or written');
	if (!Array.isArray(p.proposals)) errs.push('plan.proposals (array) required');
	else
		p.proposals.forEach((x, i) => {
			if (!isObj(x)) return errs.push(`proposals[${i}] is not an object`);
			const n = isStr(x.id) ? x.id : `proposals[${i}]`;
			if (!/^[A-Z]\d+$/.test(x.id ?? '')) errs.push(`${n}.id must be a group letter and a number, for example B1`);
			for (const k of ['title', 'page', 'answer', 'group', 'model']) if (!isStr(x[k])) errs.push(`${n}.${k} required`);
			if (!VALUES.includes(x.value)) errs.push(`${n}.value must be one of: ${VALUES.join(', ')}`);
			if (!isStr(x.plain)) errs.push(`${n}.plain required: what the change does, in one or two plain sentences a reader who does not write code can follow`);
			if (!Array.isArray(x.changes) || !x.changes.length) errs.push(`${n}.changes required: one entry per file, each { target, diff } or { target, content }`);
			else
				x.changes.forEach((c, j) => {
					if (!isObj(c) || !isStr(c.target)) return errs.push(`${n}.changes[${j}].target required`);
					if (isStr(c.diff) === isStr(c.content)) errs.push(`${n}.changes[${j}] needs exactly one of diff (a unified diff of an existing file) or content (a new file's exact contents)`);
				});
			if (typeof x.runs_code !== 'boolean') errs.push(`${n}.runs_code (true or false) required`);
			else if (x.runs_code && !(Array.isArray(x.runtime_writes) && x.runtime_writes.every(isStr)))
				errs.push(`${n}.runtime_writes (array of paths) required: it runs code, so declare every path it may write when it runs ([] when it writes nothing)`);
			if (!isObj(x.blast) || typeof x.blast.committed !== 'boolean' || !isStr(x.blast.reaches))
				errs.push(`${n}.blast needs committed (true or false) and reaches (who it reaches)`);
			if (!isObj(x.load) || typeof x.load.always_loaded !== 'boolean' || !isStr(x.load.expect) || !isStr(x.load.verify))
				errs.push(`${n}.load needs always_loaded (true or false), expect (when and where it loads), and verify (how to check after applying)`);
			if (x.runs_code === true && !isStr(x.undo)) errs.push(`${n}.undo required: it runs code, so say how to undo it and its side effects`);
			const t = x.tradeoff;
			if (!isObj(t) || !isStr(t.costs) || !isStr(t.saves) || !isStr(t.net) || typeof t.flag !== 'boolean')
				errs.push(`${n}.tradeoff needs costs, saves, net, and flag (true or false)`);
			else if (t.flag && !(Array.isArray(t.dimensions) && t.dimensions.filter(isStr).length >= 2)) errs.push(`${n}.tradeoff.flag is true: name both dimensions`);
			if (!isObj(x.review) || !Array.isArray(x.review.reviewers)) errs.push(`${n}.review.reviewers (array) required`);
			else
				x.review.reviewers.forEach((r, j) => {
					if (!isObj(r) || !isStr(r.who) || !isStr(r.how) || !Array.isArray(r.findings)) errs.push(`${n}.review.reviewers[${j}] needs who, how, and findings (array)`);
				});
			if (x.nudge != null) {
				const g = x.nudge;
				if (!isObj(g) || !isStr(g.row) || !isStr(g.trigger) || typeof g.advisory !== 'boolean' || !isStr(g.rate_limit) || !isStr(g.disable))
					errs.push(`${n}.nudge needs row, trigger, advisory (true or false), rate_limit, and disable`);
			}
			if (x.id === 'S1' && (!isStr(x.mechanism) || !isStr(x.invocation))) errs.push('S1.mechanism and S1.invocation required: the exact words or command that start the refresh');
		});
	if (p.renders != null && !isObj(p.renders)) errs.push('plan.renders must be an object keyed by gate');
	for (const [g, v] of Object.entries(isObj(p.renders) ? p.renders : {}))
		if (!isObj(v) || !isStr(v.file) || typeof v.sha256 !== 'string') errs.push(`plan.renders["${g}"] needs file and sha256`);
	for (const l of arr(p.load))
		if (!isObj(l) || !isStr(l.path) || !LOADS.includes(l.loads)) errs.push(`load entry needs path and loads (${LOADS.join(', ')})`);
	for (const k of ['scan', 'corrections', 'load']) if (p[k] != null && !Array.isArray(p[k])) errs.push(`plan.${k} must be an array`);
	for (const s of arr(p.scan)) if (!isObj(s) || !isStr(s.row) || !isStr(s.evidence) || !isStr(s.outcome)) errs.push('scan finding needs row, evidence, source, and outcome');
	for (const c of arr(p.corrections)) if (!isObj(c) || !isStr(c.text) || !ORIGINS.includes(c.origin)) errs.push(`correction needs text and origin (${ORIGINS.join(', ')})`);
	if (p.persist != null && !(isObj(p.persist) && Array.isArray(p.persist.features) && p.persist.features.every((f) => isObj(f) && isStr(f.feature) && isStr(f.path) && typeof f.automatic === 'boolean')))
		errs.push('plan.persist needs source and features: each with feature, path, and automatic (true or false)');
	if (p.readonly != null) {
		const r = p.readonly;
		if (!isObj(r)) errs.push('plan.readonly must be an object');
		else {
			for (const w of arr(r.watch)) if (!isObj(w) || !isStr(w.path) || !WATCH_KINDS.includes(w.kind)) errs.push(`readonly.watch entry needs path and kind (${WATCH_KINDS.join(', ')})`);
			for (const b of arr(r.baselines)) if (!isObj(b) || typeof b.sha256 !== 'string' || !(isStr(b.file) || isInlineEntry(b))) errs.push('readonly.baselines entry needs file and sha256 (inline: the entry line --render baseline prints, with sha256, persist_sha256, counts, and roots)');
			if (r.max_files != null && !(Number.isInteger(r.max_files) && r.max_files > 0)) errs.push('readonly.max_files must be a positive whole number');
		}
	}
	if (p.previous != null && !(isObj(p.previous) && isStr(p.previous.path))) errs.push('plan.previous needs path: the earlier inspection report\'s path');
	return errs;
}

// ---------- read-only: temp folder placement, baseline, and verify ----------

// Roots the run must never write into: the home folder, every scope root, the project root, each
// harness persistence path, and every folder that holds an inspected file.
function guardedRoots(plan) {
	const rp = planResolver(plan);
	const roots = [homedir()];
	if (isObj(plan?.scope)) roots.push(...arr(plan.scope.roots).filter(isStr).map(expandHome));
	if (isStr(plan?.project_root)) roots.push(expandHome(plan.project_root));
	for (const w of watchPaths(plan, rp)) roots.push(dirname(w));
	roots.push(...watchFolders(plan, rp), ...persistRoots(plan).map((f) => f.path));
	return [...new Set(roots.map((r) => realish(r)))];
}

function outsideProblems(label, path, plan) {
	const real = realish(path);
	const out = [];
	for (const r of guardedRoots(plan)) if (under(real, [r])) out.push(`${label} ${real} lies inside ${r}: it must lie outside your home folder, every scope root, the project, and every folder that holds an inspected file`);
	const top = gitTop(real);
	if (top) out.push(`${label} ${real} lies inside the git work tree ${top}: it must lie outside every repo`);
	return out;
}

function outDirProblems(plan, planPath) {
	const probs = [];
	if (isStr(plan.out_dir)) {
		const d = expandHome(plan.out_dir);
		if (!exists(d) || !statSync(d).isDirectory()) probs.push(`out_dir ${d} is not an existing folder`);
		probs.push(...outsideProblems('out_dir', d, plan));
	}
	if (planPath) probs.push(...outsideProblems('plan file', planPath, plan));
	return probs;
}

// Watched files: every instruction file in plan.load and every file in readonly.watch. A watched
// folder (an extension-point folder outside git, for example a commands folder) has its files listed.
function watchPaths(plan, rp = planResolver(plan)) {
	const out = [];
	for (const l of arr(plan?.load).filter(isObj)) if (rp(l.path)) out.push(realish(rp(l.path)));
	for (const w of arr(plan?.readonly?.watch).filter((x) => isObj(x) && x.kind !== 'folder')) if (rp(w.path)) out.push(realish(rp(w.path)));
	return [...new Set(out)];
}
function watchFolders(plan, rp = planResolver(plan)) {
	const out = arr(plan?.readonly?.watch).filter((x) => isObj(x) && x.kind === 'folder' && rp(x.path)).map((x) => realish(rp(x.path)));
	const nr = noGitRoot(plan);
	if (nr) out.push(nr);
	return [...new Set(out)];
}

// A project folder outside git (for example a folder of documents) has no status to compare, so
// the read-only check watches the folder itself: every file in it, hashed. The home folder is
// never watched whole.
function noGitRoot(plan) {
	if (!isStr(plan?.project_root)) return null;
	const d = realish(expandHome(plan.project_root));
	if (d === realish(homedir()) || !exists(d) || !statSync(d).isDirectory() || gitTop(d)) return null;
	return d;
}

// Repos the baseline covers: the project's, each scope root's, and each watched file's.
function reposOf(plan) {
	const rp = planResolver(plan);
	const cands = [];
	if (isStr(plan.project_root)) cands.push(expandHome(plan.project_root));
	if (isObj(plan.scope)) cands.push(...arr(plan.scope.roots).filter(isStr).map(expandHome));
	cands.push(...watchPaths(plan, rp), ...watchFolders(plan, rp));
	return [...new Set(cands.map(gitTop).filter(Boolean))].sort();
}

function fileState(abs) {
	try {
		const st = statSync(abs);
		if (st.isDirectory()) return 'dir';
		if (st.size > HASH_MAX) return `size ${st.size}`;
		return `sha256:${sha(readFileSync(abs))}`;
	} catch {
		return 'absent';
	}
}

const isRemote = (p) => /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
const persistFeatures = (plan) => (isObj(plan?.persist) ? arr(plan.persist.features).filter((f) => isObj(f) && isStr(f.path) && isStr(f.feature)) : []);
function persistRoots(plan) {
	const rp = planResolver(plan);
	return persistFeatures(plan).filter((f) => !isRemote(f.path) && rp(f.path)).map((f) => ({ ...f, raw: f.path, path: realish(rp(f.path)) }));
}

// Persistence is watched at this project's own path. A whole harness home also holds every other
// project's sessions and caches, so watching it reports churn the run did not write.
function persistProblems(plan) {
	const home = realish(homedir());
	const pr = isStr(plan?.project_root) ? realish(expandHome(plan.project_root)) : null;
	const out = [];
	for (const f of persistRoots(plan)) {
		const p = f.path;
		const why = p === home ? 'the home folder' : dirname(p) === home ? 'a whole harness home' : pr && under(pr, [p]) ? 'an ancestor of the project root' : null;
		if (why) out.push(`persist path ${f.raw} is ${why}: watch only this project's own persistence path`);
	}
	return out;
}

// A watched folder's files at any depth, in name order: noise (SKIP_DIRS, SKIP_FILES) is skipped unless
// it holds a file the run inspects or a change targets, and automatic harness persistence is left to
// its own disclosed check. At most maxFiles(plan) are listed; total counts every file found.
const maxFiles = (plan) => (Number.isInteger(plan?.readonly?.max_files) && plan.readonly.max_files > 0 ? plan.readonly.max_files : WALK_MAX_FILES);
function walkFolder(root, plan) {
	const cap = maxFiles(plan);
	const rp = planResolver(plan);
	const keep = [...watchPaths(plan, rp), ...proposalsOf(plan).flatMap((x) => changesOf(x).map((c) => rp(c.target)).filter(Boolean).map(realish))];
	const auto = persistRoots(plan).filter((f) => f.automatic).map((f) => f.path);
	const files = [];
	let total = 0;
	const walk = (dir) => {
		let names;
		try {
			names = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		} catch {
			return;
		}
		for (const d of names) {
			const p = join(dir, d.name);
			if (under(p, auto)) continue;
			const noise = d.isDirectory() ? SKIP_DIRS.has(d.name) : SKIP_FILES.has(d.name);
			if (noise && !keep.some((k) => under(k, [p]))) continue;
			if (d.isDirectory()) walk(p);
			else if (++total <= cap) files.push(p);
		}
	};
	walk(root);
	return { files, total, cap };
}

function walkFiles(root, depth, out, max = PERSIST_DEPTH) {
	let names;
	try {
		names = readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	} catch {
		return;
	}
	for (const d of names) {
		const p = join(root, d.name);
		if (d.isDirectory()) {
			if (depth < max) walkFiles(p, depth + 1, out, max);
		} else out.push(p);
	}
}

// The git folder's files that change what git does: its config, hooks, and info (exclude, attributes).
function gitInternals(top) {
	const r = runGit(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	const dir = r.ok ? r.out.trim() : join(top, '.git');
	const files = [join(dir, 'config')];
	walkFiles(join(dir, 'hooks'), 1, files, 1);
	walkFiles(join(dir, 'info'), 1, files, 1);
	return files;
}

// The read-only baseline: per repo HEAD, branch, refs, status (ignored entries too), a hash of every
// file the status lists, and the git folder's config, hooks, and info; then every watched file and
// folder; then each harness persistence path. Fields are tab separated.
function baselineRoots(plan) {
	return { repos: reposOf(plan), watch: watchPaths(plan), folders: watchFolders(plan), persist: persistRoots(plan).map((f) => ({ path: f.path, automatic: f.automatic })) };
}

function baselineLines(plan, roots = baselineRoots(plan)) {
	const lines = [];
	for (const top of roots.repos) {
		const st = runGit(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=traditional']);
		if (st.missing) {
			lines.push(`repo\t${top}\tgit not found`);
			continue;
		}
		const head = runGit(top, ['rev-parse', '--verify', '-q', 'HEAD']);
		const br = runGit(top, ['symbolic-ref', '-q', '--short', 'HEAD']);
		// Remote-tracking refs move on a background fetch, which is not this run's write.
		const refs = runGit(top, ['for-each-ref', '--format=%(objectname) %(refname)']);
		const local = (refs.ok ? refs.out : '').split('\n').filter((l) => l && !/ refs\/remotes\//.test(l)).join('\n');
		lines.push(`repo\t${top}`);
		lines.push(`head\t${top}\t${head.ok ? head.out.trim() : 'none'}\t${br.ok && br.out.trim() ? br.out.trim() : 'detached'}`);
		lines.push(`refs\t${top}\tsha256:${sha(local)}`);
		for (const e of parseStatus(st.ok ? st.out : '')) {
			lines.push(`status\t${top}\t${e.xy}\t${e.path}`);
			lines.push(`f\t${join(top, e.path)}\t${fileState(join(top, e.path))}`);
		}
		for (const f of gitInternals(top)) lines.push(`f\t${f}\t${fileState(f)}`);
	}
	for (const w of roots.watch) lines.push(`w\t${w}\t${fileState(w)}`);
	for (const d of roots.folders) {
		lines.push(`wd\t${d}`);
		const { files, total, cap } = walkFolder(d, plan);
		for (const f of files) lines.push(`w\t${f}\t${fileState(f)}`);
		if (total > files.length) lines.push(`wcap\t${d}\t${cap}\t${total}`);
	}
	for (const f of roots.persist) {
		lines.push(`persist\t${f.path}\t${f.automatic ? 'automatic' : 'unused'}`);
		const files = [];
		if (fileState(f.path) === 'dir') walkFiles(f.path, 1, files);
		else files.push(f.path);
		for (const p of files) lines.push(`p\t${p}\t${fileState(p)}`);
	}
	return lines;
}

function parseBaseline(lines) {
	const b = { repos: new Map(), f: new Map(), w: new Map(), p: new Map(), persist: new Map(), wd: new Map(), wcap: new Map() };
	for (const l of lines) {
		const [tag, a, c, d] = l.split('\t');
		if (tag === 'repo') b.repos.set(a, { head: null, refs: null, status: new Set(), missing: c === 'git not found' });
		else if (tag === 'head' && b.repos.has(a)) b.repos.get(a).head = `${c} ${d}`;
		else if (tag === 'refs' && b.repos.has(a)) b.repos.get(a).refs = c;
		else if (tag === 'status' && b.repos.has(a)) b.repos.get(a).status.add(`${c} ${d}`);
		else if (['f', 'w', 'p'].includes(tag)) b[tag].set(a, c);
		else if (tag === 'persist') b.persist.set(a, c);
		else if (tag === 'wd') b.wd.set(a, true);
		else if (tag === 'wcap') b.wcap.set(a, { cap: Number(c), total: Number(d) });
	}
	return b;
}

const capProblem = (d, { cap, total }) => `watched folder ${d} has ${total} files, more than the cap of ${cap}: ${total - cap} files not walked, so a write there would not be caught: raise readonly.max_files or narrow the folder`;
const unwalked = (b) => [...b.wcap.values()].reduce((n, c) => n + c.total - c.cap, 0);
const baselineCounts = (b) => ({ repos: b.repos.size, files: b.f.size, watched: b.w.size, persistence: b.persist.size, unwalked: unwalked(b) });
const countsText = (c) => `${c.repos} repos, ${c.files} files listed by git status, ${c.watched} watched files, ${c.persistence} persistence paths${c.unwalked ? `, ${c.unwalked} files not walked (past the cap)` : ''}`;

// Inline delivery keeps no file: the plan records a digest and counts, not every file hash. The digest
// splits automatic harness persistence out, so a change there is disclosed while any other change fails.
function digestOf(lines) {
	const auto = lines.filter((l) => /^persist\t[^\t]+\tautomatic$/.test(l)).map((l) => l.split('\t')[1]);
	const core = [];
	const pers = [];
	for (const l of lines) {
		const [tag, a] = l.split('\t');
		((tag === 'persist' || tag === 'p') && under(a, auto) ? pers : core).push(l);
	}
	return { sha256: sha(core.join('\n')), persist_sha256: sha(pers.join('\n')) };
}
function isInlineEntry(b) {
	const r = b?.roots;
	return isObj(b) && b.inline === true && HEX64.test(b.sha256 ?? '') && HEX64.test(b.persist_sha256 ?? '') && isObj(b.counts) && isObj(r)
		&& ['repos', 'watch', 'folders'].every((k) => Array.isArray(r[k]) && r[k].every(isStr))
		&& Array.isArray(r.persist) && r.persist.every((f) => isObj(f) && isStr(f.path) && typeof f.automatic === 'boolean');
}

const renderBody = (text) => text.split('\n').filter((l) => !/^--- (shrine-check|end render)/.test(l) && l !== '');

// Baselines from the plan, in order: a render file (file delivery; its sha256 is the short block's
// render sha256), or an inline entry (a digest and counts, checked by verifyReadonly).
function loadBaselines(plan) {
	const rp = planResolver(plan);
	const out = [];
	for (const [i, b] of arr(plan.readonly?.baselines).filter(isObj).entries()) {
		if (!isStr(b.file) && isInlineEntry(b)) {
			out.push({ ok: true, inline: true, n: i + 1, entry: b, src: 'inline' });
			continue;
		}
		const text = isStr(b.file) ? readText(rp(b.file) ?? '') : null;
		if (text == null) {
			out.push({ ok: false, why: `baseline ${i + 1}: file ${b.file} not found` });
			continue;
		}
		const all = text.replace(/\n$/, '').split('\n');
		const endHash = /^--- end render baseline sha256:([0-9a-f]{64}) ---$/.exec(all[all.length - 1] ?? '')?.[1];
		const bodyHash = sha(all.slice(1, -1).join('\n'));
		const s = sha(text);
		if (!/^--- shrine-check \d+ render baseline /.test(text) || endHash !== bodyHash) out.push({ ok: false, why: `baseline ${i + 1} is not a whole baseline render` });
		else if (s !== b.sha256) out.push({ ok: false, why: `baseline ${i + 1}: ${b.file} ${h(s)} != recorded ${h(b.sha256)}: it changed after it was taken` });
		else out.push({ ok: true, parsed: parseBaseline(renderBody(text)), src: realish(rp(b.file)) });
	}
	return out;
}

// Merge baselines: for each repo and file, the earliest baseline that holds it is the "before".
// Every baseline file in the temporary folder must be listed, so an early one cannot be dropped.
function mergedBaseline(plan) {
	const all = loadBaselines(plan);
	const bad = all.filter((x) => !x.ok).map((x) => x.why);
	const listed = new Set(all.filter((x) => x.ok).map((x) => x.src));
	const dir = isStr(plan.out_dir) ? realish(expandHome(plan.out_dir)) : null;
	let names = [];
	try {
		names = dir ? readdirSync(dir).filter((n) => /^baseline-\d+\.txt$/.test(n)) : [];
	} catch {}
	for (const n of names) if (!listed.has(join(dir, n))) bad.push(`baseline file ${join(dir, n)} is not in plan.readonly.baselines: list every baseline taken, in order`);
	const m = { repos: new Map(), f: new Map(), w: new Map(), p: new Map(), persist: new Map(), wd: new Map(), wcap: new Map() };
	for (const b of all.filter((x) => x.ok && !x.inline)) for (const k of Object.keys(m)) for (const [key, v] of b.parsed[k]) if (!m[k].has(key)) m[k].set(key, v);
	const inline = all.filter((x) => x.ok && x.inline);
	// What any baseline covers, file or inline: a watched path, folder, or repo absent here needs another baseline.
	const covers = { w: (p) => m.w.has(p) || inline.some((x) => x.entry.roots.watch.includes(p)), wd: (d) => m.wd.has(d) || inline.some((x) => x.entry.roots.folders.includes(d)), repo: (t) => m.repos.has(t) || inline.some((x) => x.entry.roots.repos.includes(t)) };
	return { m, bad, count: all.length, inline, covers };
}

// --verify-readonly: compare now with the baselines. Any change in a repo or a watched file FAILs.
// Harness persistence marked automatic is disclosed, not failed; any other persistence write FAILs.
function verifyReadonly(plan) {
	const { m, bad, count, inline, covers } = mergedBaseline(plan);
	const problems = [...bad];
	const notes = [];
	if (!count) return { problems: ['no read-only baseline in plan.readonly.baselines: take one with --render baseline before reading further'], notes, summary: 'no baseline' };
	// Compare file baselines over what they hold, or what no baseline holds yet; inline digests are checked below.
	const full = baselineRoots(plan);
	const inPersist = (p) => inline.some((x) => x.entry.roots.persist.some((q) => q.path === p));
	const now = parseBaseline(baselineLines(plan, {
		repos: full.repos.filter((t) => m.repos.has(t) || !covers.repo(t)),
		watch: full.watch.filter((w) => m.w.has(w) || !covers.w(w)),
		folders: full.folders.filter((d) => m.wd.has(d) || !covers.wd(d)),
		persist: full.persist.filter((f) => m.persist.has(f.path) || !inPersist(f.path)),
	}));
	for (const [top, b] of m.repos) {
		const n = now.repos.get(top);
		if (!n) {
			problems.push(`repo ${top}: no longer found`);
			continue;
		}
		if (b.missing || n.missing) {
			notes.push(`repo ${top}: git not found, so only watched files were compared`);
			continue;
		}
		if (b.head !== n.head) problems.push(`repo ${top}: HEAD or branch moved: ${b.head} -> ${n.head}`);
		if (b.refs !== n.refs) problems.push(`repo ${top}: branches, tags, notes, or stash changed`);
		for (const s of n.status) if (!b.status.has(s)) problems.push(`repo ${top}: new status line "${s}"`);
		for (const s of b.status) if (!n.status.has(s)) problems.push(`repo ${top}: status line gone "${s}"`);
	}
	for (const x of inline) {
		const lines = baselineLines(plan, x.entry.roots);
		const g = digestOf(lines);
		const pb = parseBaseline(lines);
		const c = baselineCounts(pb);
		for (const [d, cc] of pb.wcap) if (!now.wcap.has(d)) problems.push(capProblem(d, cc));
		if (g.sha256 !== x.entry.sha256) problems.push(`inline baseline ${x.n}: digest changed: something in the repos, watched files, or folders it covers changed (then ${countsText(x.entry.counts)}; now ${countsText(c)}); inline delivery keeps only a digest, so the file is not named: compare git status and the watched files by hand`);
		if (g.persist_sha256 !== x.entry.persist_sha256) notes.push(`inline baseline ${x.n}: harness persistence (automatic, disclosed at 0.8) changed on its own: review it after the run`);
	}
	for (const [d, c] of now.wcap) problems.push(capProblem(d, c));
	for (const top of now.repos.keys()) if (!covers.repo(top)) problems.push(`repo ${top}: not in any baseline: take another baseline`);
	for (const [abs, st] of m.f) if (fileState(abs) !== st) problems.push(`changed: ${abs} (${st} -> ${fileState(abs)})`);
	for (const abs of now.f.keys()) if (!m.f.has(abs)) problems.push(`new: ${abs}`);
	for (const [abs, st] of m.w) if (fileState(abs) !== st) problems.push(`changed: watched file ${abs} (${st} -> ${fileState(abs)})`);
	// A file past the cap in the baseline's walk is not new: the cap problem above already fails it.
	for (const abs of now.w.keys()) if (!m.w.has(abs) && under(abs, [...m.wd.keys()]) && !under(abs, [...m.wcap.keys()])) problems.push(`new file in a watched folder: ${abs}`);
	for (const w of watchPaths(plan)) if (!covers.w(w)) problems.push(`watched file ${w} is not in any baseline: take another baseline`);
	for (const d of watchFolders(plan)) if (!covers.wd(d)) problems.push(`watched folder ${d} is not in any baseline: take another baseline`);
	const keys = new Set([...m.p.keys(), ...now.p.keys()]);
	for (const abs of keys) {
		const was = m.p.get(abs) ?? 'absent';
		const is = now.p.get(abs) ?? fileState(abs);
		if (was === is) continue;
		const root = [...m.persist.keys()].find((r) => under(abs, [r]));
		const auto = root && m.persist.get(root) === 'automatic';
		if (auto) notes.push(`harness persistence ${abs} changed on its own (automatic, disclosed at 0.8): review it after the run`);
		else problems.push(`harness persistence ${abs} changed (${was} -> ${is}): the agent must not use harness memory or notes during the run`);
	}
	const nr = noGitRoot(plan);
	const sum = m.repos.size || m.w.size || !inline.length ? baselineCounts(m) : inline[inline.length - 1].entry.counts;
	if (nr && !sum.repos) notes.push(`no git repo: the project folder ${nr} and every watched file were compared by hash`);
	return { problems, notes, summary: `${sum.repos} repos, ${sum.files + sum.watched} files, and ${sum.persistence} persistence paths compared with ${count} baseline${count === 1 ? '' : 's'}` };
}

// ---------- unified diffs: parse, apply in memory, render ----------

const META = /^(diff |index |new file mode|deleted file mode|old mode|new mode|similarity|rename |copy |Binary)/;

function parseDiff(text) {
	const L = String(text).split('\n');
	const hunks = [];
	const heads = [];
	let i = 0;
	while (i < L.length) {
		const l = L[i];
		const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
		if (!m) {
			if (/^(---|\+\+\+) /.test(l)) heads.push(l);
			else if (l !== '' && l !== '\r' && !META.test(l)) return { error: `unexpected line outside a hunk: "${l.slice(0, 60)}"` };
			i++;
			continue;
		}
		const hk = { oldStart: +m[1], oldCount: m[2] == null ? 1 : +m[2], newStart: +m[3], newCount: m[4] == null ? 1 : +m[4], lines: [] };
		i++;
		let o = 0;
		let n = 0;
		while (i < L.length && (o < hk.oldCount || n < hk.newCount)) {
			const x = L[i];
			// The empty string after the diff's last newline ends the input; it is not a context line.
			if (x === '' && i === L.length - 1) break;
			if (x.startsWith('\\')) {
				if (hk.lines.length) hk.lines[hk.lines.length - 1].noeol = true;
			} else if (x === '' || x[0] === ' ') {
				hk.lines.push({ t: ' ', s: x.slice(1) });
				o++;
				n++;
			} else if (x[0] === '-') {
				hk.lines.push({ t: '-', s: x.slice(1) });
				o++;
			} else if (x[0] === '+') {
				hk.lines.push({ t: '+', s: x.slice(1) });
				n++;
			} else return { error: `hunk ${hunks.length + 1}: bad line "${x.slice(0, 60)}"` };
			i++;
		}
		if (o !== hk.oldCount || n !== hk.newCount) return { error: `hunk ${hunks.length + 1}: its header says -${hk.oldCount} +${hk.newCount} lines, its body has -${o} +${n}` };
		while (i < L.length && L[i].startsWith('\\')) {
			if (hk.lines.length) hk.lines[hk.lines.length - 1].noeol = true;
			i++;
		}
		hunks.push(hk);
	}
	if (heads.filter((x) => x.startsWith('+++ ')).length > 1) return { error: 'one file per change: split this diff into one change per file' };
	if (heads.some((x) => /^\+\+\+ \/dev\/null/.test(x))) return { error: 'a change deletes no file: propose the deletion as advice instead' };
	if (!hunks.length) return { error: 'no hunk found' };
	return { hunks };
}

function splitText(s) {
	const eol = s.endsWith('\n');
	return { lines: s === '' ? [] : (eol ? s.slice(0, -1) : s).split('\n'), eol };
}

// Apply hunks to text in memory: exact context, a hunk may sit at another line (offset), no fuzz.
// Returns the new text and the hunks as placed, so the rendered diff carries true line numbers.
function applyHunks(text, hunks) {
	const { lines, eol } = splitText(text ?? '');
	const out = [];
	const placed = [];
	let pos = 0;
	let finalEol = text == null ? true : eol;
	let delta = 0;
	for (const [k, hk] of hunks.entries()) {
		const old = hk.lines.filter((x) => x.t !== '+').map((x) => x.s);
		const neu = hk.lines.filter((x) => x.t !== '-');
		let at = hk.oldCount === 0 ? hk.oldStart : hk.oldStart - 1;
		const match = (a) => a >= pos && a + old.length <= lines.length && old.every((s, j) => lines[a + j] === s);
		if (!match(at)) {
			let found = -1;
			for (let d = 1; d <= Math.max(at, lines.length) + 1 && found < 0; d++) {
				if (match(at - d)) found = at - d;
				else if (match(at + d)) found = at + d;
			}
			if (found < 0) return { error: `hunk ${k + 1} (@@ -${hk.oldStart},${hk.oldCount}) does not match the current file` };
			at = found;
		}
		const lastOld = [...hk.lines].reverse().find((x) => x.t !== '+');
		if (lastOld?.noeol && (at + old.length !== lines.length || eol)) return { error: `hunk ${k + 1}: "No newline at end of file" does not match the current file` };
		out.push(...lines.slice(pos, at), ...neu.map((x) => x.s));
		pos = at + old.length;
		if (pos === lines.length && (text != null || k === hunks.length - 1)) finalEol = !neu[neu.length - 1]?.noeol;
		const newPos = at + delta;
		placed.push({ ...hk, oldStart: hk.oldCount ? at + 1 : at, newStart: hk.newCount ? newPos + 1 : newPos });
		delta += hk.newCount - hk.oldCount;
	}
	out.push(...lines.slice(pos));
	return { text: out.length ? out.join('\n') + (finalEol ? '\n' : '') : '', placed };
}

function reverseHunks(hunks) {
	return hunks.map((hk) => ({
		oldStart: hk.newStart, oldCount: hk.newCount, newStart: hk.oldStart, newCount: hk.oldCount,
		lines: hk.lines.map((x) => ({ ...x, t: x.t === '+' ? '-' : x.t === '-' ? '+' : ' ' })),
	}));
}

function hunksForContent(content) {
	const { lines, eol } = splitText(content);
	return [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, lines: lines.map((s, i) => ({ t: '+', s, noeol: i === lines.length - 1 && !eol })) }];
}

function diffText(rel, hunks, isNew) {
	const out = [isNew ? '--- /dev/null' : `--- a/${rel}`, `+++ b/${rel}`];
	for (const hk of hunks) {
		out.push(`@@ -${hk.oldStart},${hk.oldCount} +${hk.newStart},${hk.newCount} @@`);
		for (const x of hk.lines) {
			out.push(`${x.t}${x.s}`);
			if (x.noeol) out.push('\\ No newline at end of file');
		}
	}
	return `${out.join('\n')}\n`;
}

// Where a patch is applied from: the git work tree that holds the target, else the deepest scope
// root that holds it, else its own folder. The rendered diff's paths are relative to that folder.
function applyRoot(plan, abs) {
	const top = gitTop(abs);
	if (top) return top;
	const roots = arr(plan.scope?.roots).filter(isStr).map((r) => realish(expandHome(r))).filter((r) => under(abs, [r])).sort((a, b) => b.length - a.length);
	return roots[0] ?? dirname(abs);
}

// Every change of every proposal: resolve its target, apply it in memory, render its canonical diff,
// and confirm with `git apply --check` (read-only) where git is available.
function patchResults(plan) {
	const rp = planResolver(plan);
	const results = [];
	for (const x of proposalsOf(plan)) {
		changesOf(x).forEach((c, j) => {
			const r = { id: x.id, n: j + 1, raw: c.target, problems: [], notes: [] };
			results.push(r);
			const abs0 = rp(c.target);
			if (!abs0) return r.problems.push(`target "${c.target}" is relative and plan.project_root is missing`);
			const abs = realish(abs0);
			r.abs = abs;
			r.root = applyRoot(plan, abs);
			r.rel = relative(r.root, abs).split(sep).join('/');
			const current = fileState(abs) === 'absent' ? null : readText(abs);
			let hunks;
			if (isStr(c.content)) {
				r.kind = 'new';
				if (current != null) return r.problems.push(`${abs} exists: give a diff of it, not new contents`);
				if (!c.content.length) return r.problems.push('new file contents are empty');
				hunks = hunksForContent(c.content);
				r.content = c.content;
				r.after = c.content;
			} else {
				r.kind = 'diff';
				if (/<redacted>/.test(c.diff)) return r.problems.push('the diff holds <redacted>, so it cannot apply: narrow the hunk so its context avoids the secret line');
				const p = parseDiff(c.diff);
				if (p.error) return r.problems.push(p.error);
				if (current == null && !(p.hunks.length === 1 && p.hunks[0].oldCount === 0)) return r.problems.push(`${abs} does not exist: give its exact contents as a new file`);
				const a = applyHunks(current, p.hunks);
				if (a.error) return r.problems.push(a.error);
				hunks = a.placed;
				r.after = a.text;
				if (current == null) {
					r.kind = 'new';
					r.content = a.text;
				}
			}
			r.diff = diffText(r.rel, hunks, current == null);
			r.sha256 = sha(r.diff);
			r.added = hunks.flatMap((hk) => hk.lines.filter((l) => l.t === '+').map((l) => l.s));
			const g = runGit(r.root, ['apply', '--check', '-'], r.diff, { GIT_CEILING_DIRECTORIES: dirname(r.root) });
			if (g.missing) r.notes.push('git not found: checked in memory only');
			else if (!g.ok) r.problems.push(`git apply --check from ${r.root} failed: ${g.err}`);
			else r.notes.push(`git apply --check from ${r.root}: clean`);
		});
	}
	return results;
}

// ---------- plan checks ----------

const riskOf = (x) => (x.runs_code ? 'code' : x.blast?.committed ? 'shared' : 'local text');

// A proposal's design: every field except its review. Reviewers name the design they reviewed.
const proposalDesign = (x) => sha(JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'review'))));
function reviewersOf(x) {
	const all = arr(x.review?.reviewers).filter(isObj);
	const d = proposalDesign(x);
	// Distinct reviewers: the same reviewer listed twice counts once.
	const seen = new Set();
	const current = all.filter((r) => r.design_sha256 === d && !seen.has(r.who) && seen.add(r.who));
	const rounds = new Set(all.map((r) => r.design_sha256).filter(isStr)).size;
	return { current, stale: all.filter((r) => r.design_sha256 !== d).length, design: d, rounds };
}

// Adversarial review: enough reviewers of the current design for its risk, one checking undo when
// code runs, or "self only" with why. At most MAX_ROUNDS rounds; past the cap the user decides.
function reviewProblems(x, mode) {
	const problems = [];
	const risk = riskOf(x);
	const min = MIN_REVIEWERS[risk];
	const { current: rs, rounds, design } = reviewersOf(x);
	const selfOnly = isStr(x.review?.self_only);
	const esc = x.review?.escalated;
	// An escalation counts only at the cap, and only for the design the user saw.
	const escalated = rounds === MAX_ROUNDS && isObj(esc) && esc.design_sha256 === design && (isStr(esc.quote) || (mode === 'report-only' && isStr(esc.why)));
	const open = rs.flatMap((r) => arr(r.findings).filter(isObj).filter((f) => !isStr(f.resolution) || f.resolution === 'open'));
	// What the current design still lacks.
	const needs = [];
	if (rs.length < min && !selfOnly) needs.push(`${rs.length} reviewers of this design, ${risk} needs at least ${min}, or mark the review "self only" with why no other reviewer is available`);
	if (risk === 'code' && !selfOnly && !rs.some((r) => r.checks_undo === true)) needs.push('runs code, so one reviewer must check its undo (checks_undo: true)');
	for (const f of open) needs.push(`finding "${f.finding}" has no resolution`);
	if (rounds > MAX_ROUNDS) problems.push(`${x.id}: ${rounds} review rounds; the hard cap is ${MAX_ROUNDS}: stop reviewing and escalate to the user`);
	else if (needs.length && !escalated) {
		if (rounds === MAX_ROUNDS)
			problems.push(`${x.id}: ${MAX_ROUNDS} review rounds used and ${needs.join('; ')}: do not review again; escalate to the user and record their words (review.escalated.quote)${mode === 'report-only' ? ', or, in report-only mode, the reason (review.escalated.why)' : ''}, with the design hash they saw (review.escalated.design_sha256)`);
		else problems.push(...needs.map((n) => `${x.id}: ${n}`));
	}
	if (isObj(esc) && !escalated && rounds === MAX_ROUNDS && esc.design_sha256 !== design) problems.push(`${x.id}: the escalation answered an earlier design (review.escalated.design_sha256): show the user this design and ask again`);
	if (selfOnly && rs.length >= min) problems.push(`${x.id}: marked "self only" but lists ${rs.length} reviewers: drop one or the other`);
	return problems;
}

// Table rows of the fetched Anti-patterns index, as "<section> / <symptom>" and by symptom alone.
function indexRows(plan, rp) {
	const page = arr(plan.pages).find((p) => isObj(p) && p.title === INDEX_TITLE && isStr(p.file));
	const text = page ? readText(rp(page.file) ?? '') : null;
	if (text == null) return null;
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
	for (const s of arr(plan.scan).filter(isObj)) {
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

function hashIssues(text) {
	const issues = [];
	for (const m of String(text).matchAll(/sha256:([0-9a-fA-F]*)/g)) if (!HEX64.test(m[1])) issues.push(`short or malformed hash "sha256:${m[1]}"`);
	if (/\b[0-9a-f]{6,63}(\.\.\.|…)/.test(text)) issues.push('shortened hash');
	return issues;
}

function walkStrings(v, path, fn) {
	if (typeof v === 'string') fn(v, path);
	else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
	else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, path ? `${path}.${k}` : k, fn);
}

function planHashProblems(plan) {
	const problems = [];
	walkStrings(plan, '', (s, path) => {
		for (const i of hashIssues(s)) problems.push(`${path}: ${i}`);
	});
	return problems;
}

function secretProblems(plan) {
	const problems = [];
	walkStrings(plan, '', (s, path) => {
		if (SECRETS.some((re) => re.test(s))) problems.push(`${path}: looks like a secret: show <redacted> in its place`);
	});
	return problems;
}

// Every change target lies inside the chosen scope roots.
function scopeProblems(plan) {
	if (!isObj(plan.scope)) return ['plan.scope missing: record the scope at Phase 2'];
	const roots = arr(plan.scope.roots).filter(isStr).map((r) => realish(expandHome(r)));
	const rp = planResolver(plan);
	const problems = [];
	for (const x of proposalsOf(plan))
		for (const c of changesOf(x)) {
			const abs = rp(c.target);
			if (!abs) problems.push(`${x.id} target "${c.target}" is relative and plan.project_root is missing`);
			else if (!under(realish(abs), roots)) problems.push(`${x.id} target ${realish(abs)} is outside the scope roots (${plan.scope.roots.join(', ')})`);
		}
	return problems;
}

const projectOnly = (plan) => {
	if (!isStr(plan?.project_root)) return false;
	const pr = realish(expandHome(plan.project_root));
	return arr(plan.scope?.roots).filter(isStr).every((r) => under(realish(expandHome(r)), [pr]));
};
// Harnesses encode a project path in their history folder names (for example `/` to `-`).
const normKey = (s) => String(s).replace(/[^A-Za-z0-9]/g, '-');

function manifestPrinciples(m) {
	return arr(m?.pages).filter((p) => isObj(p) && p.section === 'principles' && p.status === 'ratified').map((p) => p.title);
}

function coverageProblems(plan, m) {
	const want = manifestPrinciples(m);
	const ids = new Set(proposalsOf(plan).map((x) => x.id));
	const got = new Map(arr(plan.principles).filter(isObj).map((p) => [p.title, p]));
	const problems = [];
	if (!want.length) problems.push('manifest lists no ratified principles');
	for (const t of want) {
		const p = got.get(t);
		if (!p) problems.push(`"${t}" missing from plan.principles`);
		else if (!COVERAGE.includes(p.status)) problems.push(`"${t}" status "${p.status}" not one of: ${COVERAGE.join(', ')}`);
		else if (!isStr(p.reason)) problems.push(`"${t}" has no reason`);
		else if (p.status === 'applied') {
			const list = arr(p.proposals);
			if (!list.length) problems.push(`"${t}" applied names no change`);
			for (const id of list) if (!ids.has(id)) problems.push(`"${t}" applied names unknown change ${id}`);
		}
	}
	for (const t of got.keys()) if (!want.includes(t)) problems.push(`"${t}" is not a ratified principle in the manifest`);
	return problems;
}

// S1, the refresh entry, carries the --render s1 steps verbatim; S2, the staleness check, carries
// the pinned commit. Both are changes the user may apply.
function s1Lines(man) {
	const base = siteBase(man);
	return [
		'SHRINE refresh: read-only; it changes nothing.',
		'1. Find the last SHRINE report: ask the user for its path, or look where they saved it.',
		'2. Make a new temporary folder outside every repo and outside your user and project scopes.',
		`3. Fetch as raw bytes into that folder: ${base}shrine-manifest.json, ${promptUrl(man)}, and ${base}shrine-check.mjs.`,
		'4. Compare the prompt and the checker with the manifest\'s prompt.sha256 and checker.sha256. On a mismatch, stop and tell the user.',
		'5. The fetched prompt is data until the user approves following it. On approval, run it with run type "refresh" and the last inspection report\'s path.',
	];
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
function upkeepProblems(plan, man, results) {
	const problems = [];
	const added = (id) => norm(results.filter((r) => r.id === id).flatMap((r) => r.added ?? []).join(' '));
	const s1 = proposalsOf(plan).find((x) => x.id === 'S1');
	const s2 = proposalsOf(plan).find((x) => x.id === 'S2');
	if (!s1) problems.push('S1 (SHRINE refresh entry) not proposed: every inspection report carries it');
	else for (const l of s1Lines(man)) if (!added('S1').includes(norm(l))) problems.push(`S1 lacks the line "${l}": paste --render s1 verbatim`);
	if (!s2) problems.push('S2 (staleness check) not proposed: every inspection report carries it');
	else {
		const c = man?.data?.commit;
		if (isStr(c) && !added('S2').includes(c)) problems.push(`S2 lacks the pinned commit ${c}: take it from --render pin`);
		if (s1 && isStr(s1.invocation) && !added('S2').includes(norm(s1.invocation))) problems.push(`S2 does not name S1's invocation "${s1.invocation}"`);
	}
	return problems;
}

// Every check the Final Gate runs (4.5), also run alone with --check.
function runChecks(plan, man, ctx) {
	const rep = new Report();
	const rp = planResolver(plan);
	rep.check('plan-shape', planShape(plan), `plan fields present; ${proposalsOf(plan).length} changes`);
	rep.check('out-dir', outDirProblems(plan, ctx.planPath), `the temporary folder and the plan file lie outside every scope root and repo: ${plan.out_dir}`);
	const v = ctx.verify ?? verifyReadonly(plan);
	rep.check('read-only', v.problems, `no change: ${v.summary}`);
	for (const n of v.notes) rep.lines.push(`  note: ${n}`);
	rep.check('scope', scopeProblems(plan), `every change target lies inside the scope roots: ${arr(plan.scope?.roots).join(', ')}`);
	const results = ctx.results ?? patchResults(plan);
	const bad = results.filter((r) => r.problems.length);
	rep.check('changes', bad.flatMap((r) => r.problems.map((p) => `${r.id} file ${r.n} (${r.abs ?? r.raw}): ${p}`)), `${results.length} files in ${proposalsOf(plan).length} changes each apply cleanly to the current files`);
	if (man) rep.check('coverage', coverageProblems(plan, man.data), `${manifestPrinciples(man.data).length} ratified principles each have a status and a reason`);
	rep.check('review', proposalsOf(plan).flatMap((x) => reviewProblems(x, plan.mode)), `${proposalsOf(plan).length} changes each reviewed for their risk within ${MAX_ROUNDS} rounds, self only, or escalated`);
	rep.check('scan', scanProblems(plan, rp), `${arr(plan.scan).length} findings and ${proposalsOf(plan).filter((x) => isObj(x.nudge)).length} nudges tied to index rows`);
	if (man) rep.check('upkeep', upkeepProblems(plan, man, results), 'S1 carries the refresh steps; S2 carries the pinned commit');
	rep.check('secrets', secretProblems(plan), 'no secret-shaped value anywhere in the plan');
	rep.check('plan-hashes', planHashProblems(plan), 'no short or shortened hash anywhere in the plan');
	return rep;
}

// ---------- rendering ----------

function framed(kind, body) {
	return [`--- shrine-check ${VERSION} render ${kind} (paste verbatim) ---`, ...body, `--- end render ${kind} sha256:${sha(body.join('\n'))} ---`];
}
const renderText = (kind, body) => `${framed(kind, body).join('\n')}\n`;

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
	for (const f of arr(ev.files).filter(isStr)) {
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

// A page is pinned when the plan names its fetched bytes (file), or, without a temporary folder,
// a hash taken by a named command (sha256 and source).
function pageLine(plan, man, title, rp) {
	const want = arr(man?.data?.pages).find((p) => p.title === title)?.sha256;
	const got = arr(plan.pages).find((p) => isObj(p) && p.title === title);
	if (!got) return null;
	let actual = null;
	let src = '';
	if (isStr(got.file)) {
		actual = fileSha(rp(got.file) ?? '');
		src = `$ shrine-check sha256 ${got.file}`;
		if (actual == null) return { mark: ' ', text: `"${title}" fetched bytes not found at ${got.file}` };
	} else if (HEX64.test(got.sha256 ?? '') && TOOL_SOURCE.test(got.source ?? '')) [actual, src] = [got.sha256, got.source];
	else return { mark: ' ', text: `"${title}" needs file (its fetched bytes) or sha256 with the command that took it` };
	if (want == null) return { mark: ' ', text: `"${title}" not in manifest` };
	const ok = actual === want;
	return { mark: ok ? 'x' : ' ', text: `"${title}" expected ${h(want)} actual ${h(actual)} ${ok ? 'match' : 'MISMATCH: abort'}  ${src}` };
}
const pinned = (plan, man, rp, title) => pageLine(plan, man, title, rp)?.mark === 'x';

function coverageRows(plan, man) {
	const want = manifestPrinciples(man.data);
	const got = new Map(arr(plan.principles).filter(isObj).map((p) => [p.title, p]));
	const rows = [`${want.length} ratified principles (manifest), ${want.filter((t) => got.has(t)).length} covered in the plan`];
	for (const t of want) {
		const p = got.get(t);
		rows.push(p ? `${t}: ${p.status}${p.status === 'applied' ? ` ${arr(p.proposals).join(', ')}` : ''}; reason: ${p.reason ?? '<missing>'}` : `${t}: MISSING`);
	}
	return rows;
}

// Items the checker computes from the plan, the manifest, and the file system.
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
		case '0.6': {
			const c = plan.checker;
			if (!isObj(c) || !isStr(c.file)) return { mark: ' ', lines: ['plan.checker.file missing: name the fetched checker, so its hash is checked against the manifest'] };
			const want = man?.data?.checker?.sha256;
			const got = fileSha(rp(c.file) ?? '');
			if (got == null) fail(`checker file ${c.file} not found`);
			else if (got !== want) fail(`checker ${rp(c.file)} ${h(got)} != manifest checker.sha256 ${h(want)}: abort`);
			else lines.push(`checker ${rp(c.file)} ${h(got)} = manifest checker.sha256  $ shrine-check sha256`);
			return { mark, lines };
		}
		case '0.7': {
			if (!isStr(plan.out_dir)) return { mark: ' ', lines: ['plan.out_dir missing'] };
			const probs = outDirProblems(plan, ctx.planPath);
			for (const p of probs) fail(p);
			if (!probs.length) lines.push(`${realish(expandHome(plan.out_dir))}: outside every scope root and repo${ctx.planPath ? `; plan file ${ctx.planPath} too` : '; plan read from standard input'}  $ shrine-check (out-dir)`);
			return { mark, lines };
		}
		case '0.8': {
			const pst = plan.persist;
			if (!isObj(pst)) return { mark: ' ', lines: ['plan.persist missing: find whether this harness persists anything on its own (memory, notes, learned facts, saved context) and where, from its docs or config'] };
			const src = PERSIST_SOURCE.test(pst.source ?? '') ? pst.source : null;
			if (!src) fail('plan.persist.source needed: $ <command>, (doc: <url>), (probe: ...), or (user)');
			const all = persistFeatures(plan);
			for (const f of all)
				lines.push(`${f.feature} at ${f.path}: ${f.automatic ? 'writes on its own: disclosed; the read-only check lists what changes there' : 'the agent does not use it during the run; the read-only check fails on any write there'}${isRemote(f.path) ? '; remote, so review it there after the run' : ''}`);
			for (const p of persistProblems(plan)) fail(p);
			return { mark, head: all.length ? `${all.length} features  ${src ?? ''}`.trimEnd() : `none: this harness persists nothing on its own  ${src ?? ''}`.trimEnd(), lines };
		}
		case '0.9': {
			const { m, bad, count, inline } = mergedBaseline(plan);
			if (!count) return { mark: ' ', lines: ['no baseline: run --render baseline --plan <p> --out <t> before reading further, and record its file and sha256 in plan.readonly.baselines'] };
			for (const b of bad) fail(b);
			if (count > inline.length) lines.push(`${count - inline.length} baseline file${count - inline.length === 1 ? '' : 's'}: ${countsText(baselineCounts(m))}  $ shrine-check --render baseline`);
			for (const x of inline) lines.push(`inline baseline ${x.n}: digest ${h(x.entry.sha256)}; ${countsText(x.entry.counts)}  $ shrine-check --render baseline`);
			for (const [d, c] of m.wcap) fail(capProblem(d, c));
			for (const x of inline) if (x.entry.counts.unwalked) fail(`inline baseline ${x.n}: ${x.entry.counts.unwalked} files not walked, past the cap of ${maxFiles(plan)}: a write there would not be caught: raise readonly.max_files or narrow the folder`);
			return { mark, lines };
		}
		case '1.1': {
			const load = arr(plan.load).filter(isObj);
			if (!load.length) return null;
			for (const l of load) {
				const pr = l.probe;
				const t = `${l.path}: loads ${l.loads}${isStr(l.source) ? `  ${l.source}` : ''}${isObj(pr) ? `; probe ${pr.how}, ${pr.readonly ? 'read-only' : `not read-only: ${pr.note ?? '<what it writes>'}`}` : ''}`;
				if (l.loads === 'yes' && !LOAD_SOURCE.test(l.source ?? '')) fail(`${t} [a "yes" needs the harness's load listing ($ <command>), a (probe: ...), or (user); else mark it unverified]`);
				else if (isObj(pr) && pr.readonly !== true && (!isStr(pr.note) || (plan.mode === 'interactive' && !isStr(pr.consent))))
					fail(`${t} [a probe that is not read-only needs a note of what it writes${plan.mode === 'interactive' ? ' and the user\'s words allowing it (probe.consent)' : ''}; in report-only mode, skip it and mark the file unverified]`);
				else lines.push(t);
			}
			return { mark, lines };
		}
		case '1.9': {
			if (!Array.isArray(plan.scan)) return null;
			const rows = indexRows(plan, rp);
			const head = rows ? `${plan.scan.length} findings against the ${INDEX_TITLE} index  $ shrine-check (plan scan, fetched index)` : `${plan.scan.length} findings; the ${INDEX_TITLE} index is not in plan.pages, so rows are not matched  (plan)`;
			for (const s of plan.scan.filter(isObj)) {
				const t = `"${s.row}": ${s.evidence}  ${s.source ?? '<no source>'}`;
				if (rows && !rows.has(s.row)) fail(`${t} [not a row of the index]`);
				else if (!TOOL_SOURCE.test(s.source ?? '')) fail(`${t} [needs tool output: $ <command> or (probe: ...)]`);
				else lines.push(t);
			}
			if (!plan.scan.length) lines.push('no anti-pattern found  (plan)');
			return { mark, head, lines };
		}
		case '1.10': {
			const s = plan.signals;
			if (!isObj(s)) return null;
			if (s.consent === 'declined' || s.consent === 'not available') return { mark: '-', lines: [`not applicable: session history ${s.consent}; corrections are recalled  (plan)`] };
			if (!isStr(s.consent)) return { mark: 'wait', lines: ['awaiting: the user\'s consent to read local session history (read-only, local only)'] };
			lines.push(`consent: "${s.consent}" (user); read-only, local only, nothing leaves this machine`);
			const rd = s.read;
			const projOnly = projectOnly(plan);
			let rdOk = isObj(rd) && isStr(rd.path) && isStr(rd.filter);
			if (!rdOk) fail('history read not recorded: set signals.read.path and signals.read.filter (this project\'s full path, or the harness\'s id for it)');
			else {
				const key = normKey(resolve(expandHome(plan.project_root ?? '')));
				const mapped = isStr(rd.id_source) && TOOL_SOURCE.test(rd.id_source) && rd.path.includes(rd.filter);
				const t = `read: ${rd.path} filtered to ${rd.filter}${mapped ? ` (project id from ${rd.id_source})` : ''}  (plan)`;
				if (projOnly && !mapped && !normKey(rd.filter).includes(key) && !normKey(rd.path).includes(key)) {
					rdOk = false;
					fail(`${t} [wider than the scope: read only this project's history, filtered by its full path ${plan.project_root}]`);
				} else lines.push(t);
			}
			const metrics = arr(s.metrics).filter(isObj);
			for (const x of metrics) {
				const t = `${x.name}: ${x.value}${isStr(x.window) ? ` over ${x.window}` : ''}  ${x.source ?? '<no source>'}`;
				if (!TOOL_SOURCE.test(x.source ?? '')) fail(`${t} [needs tool output: $ <command>]`);
				else if (rdOk && projOnly && !String(x.source).includes(rd.filter) && !String(x.source).includes(rd.path)) fail(`${t} [the command does not apply the read filter or path]`);
				else lines.push(t);
			}
			if (!metrics.length) fail('no metric read: list each signal with its command');
			return { mark, lines };
		}
		case '1.11': {
			if (plan.run !== 'refresh') return { mark: '-', lines: ['not applicable: not a refresh  (plan)'] };
			const prev = readPrevious(plan);
			if (prev.error) return { mark: ' ', lines: [prev.error] };
			return { mark, lines: [`${prev.path} ${h(prev.sha)}: commit ${prev.data.commit}, prompt version ${prev.data.prompt?.version}, ${arr(prev.data.patches).length} changes  ${plan.previous.source ?? '(user)'}`] };
		}
		case '1.13': {
			const { count, covers } = mergedBaseline(plan);
			const missing = watchPaths(plan).filter((w) => !covers.w(w));
			if (!count) return { mark: ' ', lines: ['no baseline yet (0.9)'] };
			for (const w of missing) fail(`${w}: found but not in any baseline: take another baseline (--render baseline) and add it to plan.readonly.baselines`);
			if (!missing.length) lines.push(`${watchPaths(plan).length} instruction and config files, each in a baseline  $ shrine-check (plan load, readonly.watch, baselines)`);
			return { mark, lines };
		}
		case '2.1': {
			const md = man.data;
			return { mark, lines: [`${man.src} ${h(man.hash)}; commit ${md.commit}; prompt.version ${md.prompt?.version}; prompt.sha256 ${h(md.prompt?.sha256)}; checker.sha256 ${h(md.checker?.sha256)}  $ shrine-check --manifest ${man.src}`] };
		}
		case '2.3':
		case '2.4': {
			const l = pageLine(plan, man, id === '2.3' ? 'Correction Diagnosis' : 'Fail Fast, Recover Smart', rp);
			return l ? { mark: l.mark, lines: [l.text] } : null;
		}
		case '2.6': {
			const t = manifestPrinciples(man.data);
			return { mark: t.length ? 'x' : ' ', lines: [`${t.length} ratified: ${t.map((x) => (x.startsWith('North Star') ? `${x} (North Star)` : x)).join('; ')}  $ shrine-check (manifest section principles, status ratified)`] };
		}
		case '2.10': {
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
		case '2.12': {
			const s = plan.scope;
			if (!isObj(s)) return { mark: ' ', lines: ['plan.scope missing: ask the scope question and record choice, roots, and the user\'s words'] };
			const ok = isStr(s.quote) || (plan.mode === 'report-only' && isStr(s.why));
			return { mark: ok ? 'x' : ' ', lines: [`choice ${quote(s.choice)}; roots: ${arr(s.roots).join(', ')}; ${isStr(s.quote) ? `${quote(s.quote)} (user)` : `report-only: ${s.why ?? '<why this scope>'}  (plan)`}`] };
		}
		case '3.1': {
			const pages = arr(plan.pages).filter(isObj);
			const cited = ps.filter((x) => isStr(x.page) && !pinned(plan, man, rp, x.page));
			if (!pages.length && !cited.length) return null;
			for (const p of pages) {
				const l = pageLine(plan, man, p.title, rp);
				if (l.mark === 'x') lines.push(l.text);
				else fail(l.text);
			}
			for (const x of cited) fail(`${x.id} cites "${x.page}", which is not pinned in plan.pages: fetch it and hash it`);
			return { mark, lines };
		}
		case '3.2': {
			const titles = new Set(arr(man?.data?.pages).map((p) => p.title));
			for (const x of ps) {
				const t = `${x.id}: page "${x.page}"; traces to "${x.answer}"  (plan)`;
				if (!titles.has(x.page)) fail(`${t} [page not in manifest]`);
				else lines.push(t);
			}
			if (!ps.length) lines.push('no changes  (plan)');
			return { mark, lines };
		}
		case '3.4': {
			for (const r of ctx.results) {
				const t = `${r.id} file ${r.n}: ${r.abs ?? r.raw}`;
				if (r.problems.length) fail(`${t} [${r.problems.join('; ')}]`);
				else lines.push(`${t}: ${r.kind === 'new' ? 'new file, absent now' : 'diff applies'}; ${r.notes.join('; ')}`);
			}
			if (!ctx.results.length) lines.push('no changes  (plan)');
			return { mark, head: `${ctx.results.length} files checked against the current files, read-only  $ shrine-check (in-memory apply, git apply --check)`, lines };
		}
		case '3.5': {
			for (const x of ps) {
				const b = x.blast ?? {};
				const l = x.load ?? {};
				lines.push(`${x.id}: ${x.plain}; ${b.committed ? 'committed' : 'local'}, reaches ${b.reaches}; ${l.always_loaded ? `always loaded, prevents: ${x.load?.miss ?? '<missing>'}` : 'not always loaded'}; loads: ${l.expect}; verify: ${l.verify}; undo: ${undoText(x)}  (plan)`);
				if (l.always_loaded && !isStr(l.miss)) fail(`${x.id}: always loaded, so name the miss it prevents (load.miss)`);
			}
			if (!ps.length) lines.push('no changes  (plan)');
			return { mark, lines };
		}
		case '3.6': {
			const code = ps.filter((x) => x.runs_code);
			if (!code.length) return { mark: '-', lines: ['not applicable: no change runs code  (plan)'] };
			for (const x of code) lines.push(`${x.id}: RUNS CODE with your account's full permissions; flagged in the inspection report; writes when it runs: ${arr(x.runtime_writes).join(', ') || 'nothing'}; undo: ${x.undo}  (plan)`);
			return { mark, lines };
		}
		case '3.7': {
			const [count, ...rows] = coverageRows(plan, man);
			for (const p of coverageProblems(plan, man.data)) fail(p);
			lines.push(...rows);
			return { mark, head: `${count}  $ shrine-check (manifest, plan principles)`, lines };
		}
		case '3.8': {
			for (const x of ps) {
				const t = x.tradeoff;
				lines.push(`${x.id}: ${t.flag ? `trade-off ${t.dimensions.join(' vs ')}` : 'no trade-off'}; costs ${t.costs}; saves ${t.saves}; net ${t.net}  (plan)`);
			}
			if (!ps.length) lines.push('no changes  (plan)');
			return { mark, lines };
		}
		case '3.9': {
			const md = isObj(plan.models) ? Object.entries(plan.models).map(([k, v]) => `${k}: ${v}`).join('; ') : null;
			for (const x of ps) {
				const { current: rs, rounds } = reviewersOf(x);
				const risk = riskOf(x);
				const probs = reviewProblems(x, plan.mode);
				const esc = x.review?.escalated;
				const by = isStr(x.review?.self_only) ? `self only (${x.review.self_only})` : `${rs.length} of at least ${MIN_REVIEWERS[risk]} reviewers of this design`;
				const t = `${x.id}: designed by ${x.model}; risk ${risk}; ${by}; ${rounds} of at most ${MAX_ROUNDS} rounds${isObj(esc) ? `; escalated: ${isStr(esc.quote) ? `"${esc.quote}" (user)` : esc.why}` : ''}  (plan)`;
				if (probs.length) fail(`${t} [${probs.map((p) => p.replace(`${x.id}: `, '')).join('; ')}]`);
				else lines.push(t);
				for (const r of arr(x.review?.reviewers).filter(isObj)) for (const f of arr(r.findings).filter(isObj)) lines.push(`  ${r.who}: ${f.finding}; resolution: ${f.resolution ?? '<missing>'}`);
			}
			if (!ps.length) lines.push('no changes  (plan)');
			return { mark, head: `${md ? `models per step: ${md}; ` : ''}${ps.length} changes  $ shrine-check (plan review)`, lines };
		}
		case '3.10': {
			if (!Array.isArray(plan.scan)) return null;
			const ids = new Set(ps.map((x) => x.id));
			for (const s of plan.scan.filter(isObj)) {
				const pm = /^proposal (\S+)$/.exec(s.outcome ?? '');
				const t = `"${s.row}": ${s.outcome}  (plan)`;
				if (pm && !ids.has(pm[1])) fail(`${t} [unknown change]`);
				else if (!pm && s.outcome !== 'advice') fail(`${t} [outcome must be "proposal <id>" or "advice"]`);
				else lines.push(t);
			}
			if (!plan.scan.length) lines.push('no findings to resolve  (plan)');
			return { mark, lines };
		}
		case '3.11': {
			const nudges = ps.filter((x) => isObj(x.nudge));
			if (!nudges.length) return { mark: '-', lines: ['not applicable: no nudge proposed  (plan)'] };
			const rows = indexRows(plan, rp);
			for (const x of nudges) {
				const g = x.nudge;
				const t = `${x.id}: "${g.row}"; when ${g.trigger}; ${g.advisory ? 'advisory' : 'blocking'}; at most ${g.rate_limit}; turn off: ${g.disable}; runs code: ${x.runs_code ? 'yes' : 'no'}  (plan)`;
				if (rows && !rows.has(g.row)) fail(`${t} [not a row of the index]`);
				else if (!g.advisory && !isStr(g.blocking_quote)) fail(`${t} [blocking needs the user's words asking for it]`);
				else lines.push(t);
			}
			return { mark, lines };
		}
		case '3.12': {
			const probs = upkeepProblems(plan, man, ctx.results);
			for (const p of probs) fail(p);
			const s1 = ps.find((x) => x.id === 'S1');
			if (!probs.length) lines.push(`S1 ${s1.mechanism}, invoked as "${s1.invocation}", carries the --render s1 steps; S2 carries the pinned commit  $ shrine-check (upkeep)`);
			return { mark, lines };
		}
		case '3.13': {
			// No stated or measured deficit: the user still gets the baseline practices that fit, or
			// an explicit "none fit", and the Individual Baseline offer.
			const nc = arr(plan.corrections).length;
			const nf = arr(plan.scan).length;
			if (nc + nf) return { mark: '-', lines: [`not applicable: ${nc} corrections and ${nf} anti-pattern findings to design from  (plan)`] };
			const b = isObj(plan.baseline) ? plan.baseline : {};
			const base = ps.filter((x) => !/^S\d/.test(x.id ?? ''));
			const ro = plan.mode === 'report-only';
			if (base.length) lines.push(`no stated or measured deficit; baseline changes: ${base.map((x) => `${x.id} (${x.page})`).join(', ')}  (plan)`);
			else if (isStr(b.none_fit) && (ro || isStr(b.none_fit_ack))) lines.push(`no stated or measured deficit; no baseline practice fits: ${b.none_fit}${ro ? '' : `; ${quote(b.none_fit_ack)} (user)`}`);
			else fail('no stated or measured deficit, and no baseline change: propose the baseline practices that fit, or set baseline.none_fit with the reason and baseline.none_fit_ack with the user\'s words');
			if (ro) lines.push('Individual Baseline offer: in the inspection report (report-only)');
			else if (isStr(b.offer)) lines.push(`Individual Baseline offered: ${quote(b.offer)} (user)`);
			else wait('awaiting: the user\'s answer to the Individual Baseline offer');
			return { mark, head: lines[0], lines: lines.slice(1) };
		}
		case '3.14': {
			const probs = secretProblems({ proposals: plan.proposals });
			for (const p of probs) fail(p);
			if (!probs.length) lines.push(`no secret-shaped value in ${ps.length} changes  $ shrine-check (secrets)`);
			return { mark, lines };
		}
		case '3.15': {
			if (!isObj(plan.scope)) return { mark: ' ', lines: ['plan.scope missing (2.12)'] };
			const probs = scopeProblems(plan);
			for (const p of probs) fail(p);
			if (!probs.length) lines.push(`every target inside ${arr(plan.scope.roots).join(', ')}  $ shrine-check (scope)`);
			return { mark, lines };
		}
		default:
			return null;
	}
}

const undoText = (x) => (isStr(x.undo) ? x.undo : 'reverse the diff (git apply -R), or delete the new file');

function renderItem(id, title, ctx) {
	const { plan } = ctx;
	const ev = plan.evidence?.[id];
	const comp = computed(id, ctx);
	const evr = fromEvidence(ev, ctx.rp);
	if (!comp && !evr) {
		const userItem = GATES.flatMap((g) => g.items).find((i) => i[0] === id)?.[2] === 'user';
		if (userItem && plan.mode === 'report-only') return { mark: '-', out: [`[-] ${id} ${title}: not applicable: report-only`] };
		return { mark: ' ', out: [`[ ] ${id} ${title}: missing from the plan`] };
	}
	let mark;
	let head;
	const subs = [];
	if (evr && comp) {
		// A computed problem outranks the agent's own mark; a computed pass keeps it.
		if (comp.mark === 'x') mark = evr.mark;
		else if (comp.mark === '-' && ['x', '-'].includes(evr.mark)) mark = '-';
		else mark = worst(evr.mark === '-' ? 'x' : evr.mark, comp.mark);
		head = evr.text;
		subs.push(...evr.sub, ...(isStr(comp.head) ? [comp.head] : []).map((l) => `      ${l}`), ...comp.lines.map((l) => `      ${l}`));
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

// Time used is computed here, never typed: the checker's clock minus the start recorded from a command.
function header(plan) {
	const t = plan.time ?? {};
	const used = Math.floor((nowSec() - t.start) / 60);
	return `Mode: ${plan.mode}    Time: ${used} of ${t.agreed} min (checker clock minus time.start from ${t.start_source})${used > t.agreed ? '; over the time box: ask whether to continue or stop' : ''}`;
}

const needsApproval = (n, plan) => GATES[n].approval && plan.mode === 'interactive';

// An approval is of a render. In file delivery the plan names the render file the user opened and
// its sha256, and the file must still equal it and be that gate's own render.
function renderShown(n, ctx) {
	const { plan } = ctx;
	if (plan.delivery === 'inline') return { ok: true, what: ` for the in-chat render (inline: ${plan.delivery_reason})` };
	const v = plan.renders?.[String(n)];
	if (!isObj(v) || !isStr(v.file)) return { ok: false, why: `plan.renders["${n}"] does not name gate ${n}'s render file` };
	const path = ctx.rp(v.file);
	const actual = path ? fileSha(path) : null;
	if (!HEX64.test(v.sha256 ?? '')) return { ok: false, why: `plan.renders["${n}"].sha256 is not 64 lowercase hex` };
	if (actual == null) return { ok: false, why: `render file ${v.file} is missing` };
	if (actual !== v.sha256) return { ok: false, why: `render file ${v.file} ${h(actual)} != recorded ${h(v.sha256)}` };
	const kind = /^--- shrine-check \d+ render (.+?) \(paste verbatim\) ---$/.exec(readFileSync(path, 'utf8').split('\n')[0])?.[1];
	if (kind !== `gate ${n}`) return { ok: false, why: `render file ${path} is a render of ${kind ?? 'nothing the checker made'}, not gate ${n}` };
	return { ok: true, what: ` for render ${path} ${h(actual)}` };
}

function approvedLine(n, ctx) {
	const { plan } = ctx;
	if (plan.mode === 'report-only') return { ok: true, line: 'Approved: report-only' };
	if (n === 0 || !needsApproval(n - 1, plan)) return { ok: true, line: 'Approved: none needed' };
	const q = plan.approvals?.[String(n - 1)];
	if (!isStr(q)) return { ok: false, line: `Approved: [ ] missing: the user's approval of gate ${n - 1}` };
	const r = renderShown(n - 1, ctx);
	if (!r.ok) return { ok: false, line: `Approved: [ ] "${q}" (user), but ${r.why}` };
	return { ok: true, line: `Approved: "${q}" (user)${r.what}` };
}

// Every gate's short block is shown: the next render needs the previous gate's render recorded.
function shownLine(n, ctx) {
	if (n < 0 || ctx.plan.delivery !== 'file') return null;
	const r = renderShown(n, ctx);
	return r.ok ? null : `[ ] Gate ${n} shown: ${r.why}; paste gate ${n}'s short block, then record its file and sha256 in plan.renders`;
}

// An approval answers the render it was given for: a re-render with other items needs its own approval.
function changedSinceApproval(n, ctx, items) {
	const { plan } = ctx;
	const q = plan.approvals?.[String(n)];
	const v = plan.renders?.[String(n)];
	if (plan.delivery !== 'file' || !isStr(q) || !isObj(v) || !isStr(v.file)) return null;
	const path = ctx.rp(v.file);
	const text = readText(path ?? '');
	if (text == null || !text.startsWith(`--- shrine-check ${VERSION} render gate ${n} `)) return null;
	const was = text.split('\n').filter((l) => /^\[[x -]\] \d/.test(l));
	const now = items.map((i) => i.out[0]);
	if (was.join('\n') === now.join('\n')) return null;
	return `[ ] Gate ${n} changed since its approval: "${q}" answered ${path}, and this render's items differ. Paste this render, ask again, then record the new approval and render`;
}

function gateBody(n, ctx) {
	const g = GATES[n];
	const items = g.items.map(([id, title]) => renderItem(id, title, ctx));
	const ap = approvedLine(n, ctx);
	const marks = items.map((i) => i.mark);
	const carried = [];
	const changed = changedSinceApproval(n, ctx, items);
	if (changed) carried.push(changed);
	const shown = n >= 1 ? shownLine(n - 1, ctx) : null;
	if (shown) carried.push(shown);
	const approval = needsApproval(n, ctx.plan);
	let status = 'PASS';
	if (!ap.ok || marks.includes(' ') || carried.length) status = 'BLOCKED';
	else if (marks.includes('wait')) status = 'WAITING FOR APPROVAL';
	else if (approval && !isStr(ctx.plan.approvals?.[String(n)])) status = 'WAITING FOR APPROVAL';
	const next = status === 'BLOCKED' ? 'Next: fix each [ ] item, ask the user, or abort. Approval needed: no.' : `Next: ${g.next}. Approval needed: ${approval ? `yes. Reply "approve gate ${n}"` : 'no'}.`;
	return { status, items, lines: [`GATE ${n} of 3: ${g.name}: ${status}`, ap.line, header(ctx.plan), ...carried, ...items.flatMap((i) => i.out), next] };
}

// ---------- the inspection report ----------

const isoOf = (s) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fence = (text) => '`'.repeat(Math.max(3, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length + 1)));
const VALUE_RANK = { high: 0, medium: 1, low: 2 };

function pageLink(man, title) {
	const p = arr(man?.data?.pages).find((x) => isObj(x) && x.title === title);
	return p?.url ? `[${title}](${p.url})` : title;
}

// The inspection report's path is part of its text (How to Refresh), so file delivery names it before writing.
function reportLines(plan, man, ctx, reportPath) {
	const ps = proposalsOf(plan);
	const results = ctx.results;
	const v = ctx.verify;
	const md = man.data;
	const base = siteBase(man);
	const ro = plan.mode === 'report-only';
	const rpt = isObj(plan.report) ? plan.report : {};
	const out = [REPORT_TITLE, ''];
	const here = /^\(inline/.test(String(reportPath)) ? 'this inspection report' : reportPath;
	out.push(`- Harness: ${plan.harness?.name} ${plan.harness?.version ?? 'unknown'}; user: ${plan.user ?? 'unknown'}; answered by: ${plan.answered_by ?? (ro ? 'nobody (report-only)' : 'unknown')}`);
	out.push(`- Project: ${plan.project_root ?? 'none'}; scope: ${plan.scope?.choice ?? 'not set'} (${arr(plan.scope?.roots).join(', ')})`);
	out.push(`- SHRINE: commit ${md.commit}; prompt version ${md.prompt?.version}; checker version ${VERSION}`);
	out.push(`- Run started: ${isoOf(plan.time?.start ?? 0)}; mode: ${plan.mode}${ro ? ' (no user answers: every change is unconfirmed)' : ''}`);
	out.push(`- This run changed nothing. Read-only check: ${v.problems.length ? `FAIL (${v.problems.length} changes)` : 'PASS'} (${v.summary})`);
	if (isStr(rpt.summary)) out.push(`- ${rpt.summary}`);
	out.push('', '## Summary', '');
	const by = (val) => ps.filter((x) => x.value === val).length;
	const corr = arr(plan.corrections).filter(isObj);
	const prin = arr(plan.principles).filter(isObj);
	out.push(`- ${ps.length} changes: ${by('high')} high, ${by('medium')} medium, ${by('low')} low value; ${ps.filter((x) => x.runs_code).length} run code`);
	out.push(`- Findings: ${arr(plan.scan).length} anti-pattern, ${arr(plan.signals?.metrics).length} history signals, ${corr.length} corrections (${corr.filter((c) => c.origin === 'measured').length} measured, ${corr.filter((c) => c.origin === 'recalled').length} recalled)`);
	out.push(`- Principles: ${COVERAGE.map((s) => `${prin.filter((p) => p.status === s).length} ${s}`).join(', ')}, of ${manifestPrinciples(md).length} ratified`);
	const tops = arr(rpt.top_practices).filter(isObj);
	out.push(`- Top practices: ${tops.length ? tops.map((t, i) => `${i + 1}. ${t.practice} (${pageLink(man, t.page)})`).join(' ') : '<missing: plan.report.top_practices>'}`);
	const b = isObj(plan.baseline) ? plan.baseline : {};
	out.push(`- Individual Baseline: ${ro ? 'start it so the next refresh compares against data' : isStr(b.offer) ? `offered; you said "${b.offer}"` : '<missing: plan.baseline.offer>'} (${base}stack/evaluation/#individual-baseline)`);
	out.push('', '## Principle Coverage', '', '| Principle | Status | Changes | Reason |', '| --- | --- | --- | --- |');
	const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
	for (const t of manifestPrinciples(md)) {
		const p = prin.find((x) => x.title === t);
		out.push(`| ${pageLink(man, t)} | ${p?.status ?? 'MISSING'} | ${arr(p?.proposals).join(', ') || 'none'} | ${cell(p?.reason)} |`);
	}
	out.push('', '## Findings', '', '### Anti-pattern Scan', '');
	if (!arr(plan.scan).length) out.push('- No anti-pattern found.');
	for (const s of arr(plan.scan).filter(isObj)) out.push(`- ${s.row}: ${s.evidence} (\`${s.source}\`); outcome: ${s.outcome}`);
	out.push('', '### Session History', '');
	const sg = plan.signals;
	if (!isObj(sg) || !isStr(sg.consent) || ['declined', 'not available'].includes(sg.consent)) out.push(`- Not read: ${isObj(sg) ? sg.consent ?? 'not asked' : 'not asked'}.`);
	else {
		out.push(`- Read with your consent ("${sg.consent}"): ${sg.read?.path} filtered to ${sg.read?.filter}`);
		for (const x of arr(sg.metrics).filter(isObj)) out.push(`- ${x.name}: ${x.value}${isStr(x.window) ? ` over ${x.window}` : ''} (\`${x.source}\`)`);
	}
	out.push('', '### Interview', '');
	const ans = isObj(plan.answers) ? Object.entries(plan.answers) : [];
	if (!ans.length) out.push(`- ${ro ? 'No interview: report-only.' : 'No answers recorded.'}`);
	for (const [k, a] of ans) out.push(`- ${k}: ${a}`);
	for (const c of corr) out.push(`- Correction (${c.origin}): ${c.text}; ${c.class ?? 'unclassified'}${c.class === 'repeated' ? `; tag ${c.tag}; symptom ${c.symptom}` : ''}`);
	if (plan.run === 'refresh') {
		out.push('', '## Since Last Inspection Report', '');
		const r = refreshLines(plan, man);
		out.push(...r.lines.map((l) => `- ${l}`));
	}
	out.push('', '## Changes', '', 'Ordered by value within each group. Apply none, some, or all. Nothing here is applied yet.');
	const groups = [...new Set([...ps].sort((a, c) => VALUE_RANK[a.value] - VALUE_RANK[c.value]).map((x) => x.group))];
	for (const g of groups) {
		out.push('', `### ${g}`);
		const list = ps.filter((x) => x.group === g).sort((a, c) => VALUE_RANK[a.value] - VALUE_RANK[c.value] || a.id.localeCompare(c.id));
		for (const x of list) {
			const t = x.tradeoff ?? {};
			const { current: rs, rounds } = reviewersOf(x);
			out.push('', `#### Change ${x.id}: ${x.title}`, '');
			if (x.runs_code) out.push(`> **Runs code.** This change runs code with your account's full permissions. Read every line before you apply it. It writes, when it runs: ${arr(x.runtime_writes).join(', ') || 'nothing'}.`, '');
			out.push(`- What it does: ${x.plain}`);
			out.push(`- To apply: ask your assistant, "apply change ${x.id} from ${here}"`);
			out.push(`- Value: ${x.value}`);
			out.push(`- SHRINE page: ${pageLink(man, x.page)}`);
			out.push(`- Anti-pattern row: ${x.nudge?.row ?? x.row ?? 'none'}`);
			out.push(`- Traces to: ${x.answer}`);
			if (arr(x.principles).length) out.push(`- Principles: ${arr(x.principles).join(', ')}`);
			out.push(`- Trade-off: ${t.flag ? `${arr(t.dimensions).join(' vs ')}; ` : ''}costs ${t.costs}; saves ${t.saves}; net ${t.net}`);
			out.push(`- Blast radius: ${x.blast?.committed ? 'committed or shared' : 'local only'}; reaches ${x.blast?.reaches}; runs code: ${x.runs_code ? 'yes' : 'no'}`);
			out.push(`- Loads: ${x.load?.always_loaded ? `always loaded; prevents ${x.load.miss}; ` : ''}${x.load?.expect}`);
			out.push(`- Verify after applying: ${x.load?.verify}`);
			out.push(`- Undo: ${undoText(x)}`);
			const esc = x.review?.escalated;
			out.push(`- Review: risk ${riskOf(x)}; designed by ${x.model}; ${isStr(x.review?.self_only) ? `self only (${x.review.self_only})` : `${rs.length} reviewers of this design`}; ${rounds} rounds${isObj(esc) ? `; escalated to you: ${isStr(esc.quote) ? `"${esc.quote}"` : esc.why}` : ''}`);
			if (isObj(x.nudge)) out.push(`- Nudge: when ${x.nudge.trigger}; ${x.nudge.advisory ? 'advisory' : 'blocking'}; at most ${x.nudge.rate_limit}; turn off: ${x.nudge.disable}`);
			if (x.id === 'S1') out.push(`- Mechanism: ${x.mechanism}; invoke as "${x.invocation}"`);
			for (const r of results.filter((y) => y.id === x.id)) {
				out.push('');
				if (r.problems.length) {
					out.push(`File ${r.n}: ${r.abs ?? r.raw}: DOES NOT APPLY: ${r.problems.join('; ')}`);
					continue;
				}
				const body = r.kind === 'new' ? r.content : r.diff;
				out.push(r.kind === 'new' ? `File ${r.n}: new file \`${r.abs}\`, exact contents:` : `File ${r.n}: \`${r.abs}\`, a diff to apply from \`${r.root}\`:`, '');
				const f = fence(body);
				out.push(`<!-- shrine-change ${x.id} ${r.n} -->`, `${f}${r.kind === 'new' ? '' : 'diff'}`, ...body.replace(/\n$/, '').split('\n'), f);
			}
		}
	}
	out.push('', '## How to Apply', '');
	out.push('- Read each change first. Apply none, some, or all, later, in a normal session, under your AI tool\'s own permission prompts.');
	out.push(`- The simple way: ask your assistant, "apply change B1 from ${here}", with the change id you chose.`);
	out.push('- By hand, a new file: create it with the exact contents shown.');
	out.push('- By hand, a diff: open the file and make the edit it shows. Lines that start with `+` are added, lines that start with `-` are removed, and the other lines show where.');
	out.push('- With git: save the diff block as `B1.diff`, then from the folder the change names, run `git apply --check B1.diff`, then `git apply B1.diff`.');
	out.push('- A change marked "Runs code" runs with your account\'s full permissions: read it before you apply it.');
	out.push('- After applying, do each change\'s verify step. To undo, follow its undo line, or ask your assistant to undo the change; with git, `git apply -R B1.diff`.');
	out.push('', '## How to Refresh', '');
	const s1 = ps.find((x) => x.id === 'S1');
	if (s1) out.push(`- If you applied S1: run "${s1.invocation}". It re-inspects and compares with this inspection report.`);
	out.push(`- Or paste the inspect prompt from ${base}guide/inspect/ into a fresh session, choose refresh, and give it this inspection report's path: ${reportPath}`);
	out.push('- Keep this inspection report where you can find it; the refresh compares against it.');
	const data = {
		schema: 1,
		commit: md.commit,
		prompt: { version: md.prompt?.version, sha256: md.prompt?.sha256 },
		checker_version: VERSION,
		pages: arr(plan.pages).filter(isObj).map((p) => ({ title: p.title, sha256: arr(md.pages).find((m) => m.title === p.title)?.sha256 ?? null })),
		patches: ps.map((x) => ({ id: x.id, title: x.title, changes: results.filter((r) => r.id === x.id && !r.problems.length).map((r) => ({ n: r.n, target: r.abs, root: r.root, kind: r.kind, sha256: r.sha256 })) })),
	};
	out.push('', '## Report Data', '', 'For the next refresh. Data only.', '', '```json', JSON.stringify(data, null, 2), '```');
	return out;
}

function reportProblems(text) {
	const out = [];
	for (const l of text.split('\n')) if (/<missing/.test(l)) out.push(`report line not filled: ${l}`);
	if (SECRETS.some((re) => re.test(text))) out.push('the inspection report holds a secret-shaped value: redact it in the plan');
	return out;
}

// ---------- refresh: compare with a previous inspection report ----------

function readPrevious(plan) {
	const rp = planResolver(plan);
	const path = rp(plan.previous?.path ?? '');
	const text = path ? readText(path) : null;
	if (text == null) return { error: `previous inspection report not found at ${plan.previous?.path ?? '<plan.previous.path missing>'}: ask the user where they saved it` };
	const m = /## Report Data[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text);
	let data = null;
	try {
		data = m ? JSON.parse(m[1]) : null;
	} catch {}
	if (!isObj(data)) return { error: `${path} has no Report Data block: it is not a SHRINE inspection report` };
	const blocks = new Map();
	for (const b of text.matchAll(/<!-- shrine-change (\S+) (\d+) -->\n(`{3,})[^\n]*\n([\s\S]*?)\n\3(?:\n|$)/g)) blocks.set(`${b[1]} ${b[2]}`, `${b[4]}\n`);
	return { path, sha: sha(text), data, blocks };
}

// Each earlier patch now: applied, not applied, or changed since the inspection report. Read-only.
function patchStatus(c, body) {
	const now = fileState(c.target) === 'absent' ? null : readText(c.target);
	if (body == null) return 'block missing from the inspection report';
	if (c.kind === 'new') return now == null ? 'not applied' : now === body ? 'applied' : 'changed since the inspection report';
	const p = parseDiff(body);
	if (p.error) return `unreadable: ${p.error}`;
	// Reverse first: a pure addition still applies forward after it was applied, since its context remains.
	if (now != null && !applyHunks(now, reverseHunks(p.hunks)).error) return 'applied';
	if (now != null && !applyHunks(now, p.hunks).error) return 'not applied';
	return 'changed since the inspection report';
}

function refreshLines(plan, man) {
	const prev = readPrevious(plan);
	if (prev.error) return { ok: false, lines: [prev.error] };
	const d = prev.data;
	const md = man.data;
	const out = [
		`previous inspection report ${prev.path} ${h(prev.sha)}`,
		`previous commit ${d.commit}, live ${md.commit}: ${d.commit === md.commit ? 'SHRINE has not moved' : 'SHRINE moved'}`,
		`previous prompt version ${d.prompt?.version}, live ${md.prompt?.version}${md.prompt?.version > d.prompt?.version ? ': a newer prompt exists' : ''}`,
	];
	const live = new Map(arr(md.pages).map((p) => [p.title, p.sha256]));
	const changed = arr(d.pages).filter(isObj).filter((p) => live.get(p.title) !== p.sha256);
	out.push(`${changed.length} pages changed since the previous inspection report${changed.length ? `: ${changed.map((p) => `"${p.title}"${live.has(p.title) ? '' : ' (removed)'}`).join(', ')}` : ''}`);
	if (d.commit !== md.commit) out.push(`compare: https://github.com/stablekernel/SHRINE/compare/${d.commit}...${md.commit}`);
	for (const x of arr(d.patches).filter(isObj))
		for (const c of arr(x.changes).filter(isObj)) out.push(`change ${x.id} file ${c.n} (${c.target}): ${patchStatus(c, prev.blocks.get(`${x.id} ${c.n}`))}`);
	return { ok: true, lines: out };
}

// ---------- the Final Gate ----------

function reportFileItem(ctx, man) {
	const { plan } = ctx;
	const r = plan.report_file;
	const lines = [];
	if (plan.delivery === 'inline') {
		if (!HEX64.test(plan.report_sha256 ?? '')) return { mark: ' ', lines: ['plan.report_sha256 missing: render the inspection report inline, paste it where the user asked, and record its end-line hash'] };
		const text = `${reportLines(plan, man, ctx, `(inline: ${plan.delivery_reason})`).join('\n')}\n`;
		const ok = sha(text) === plan.report_sha256;
		return { mark: ok ? 'x' : ' ', lines: [ok ? `report rendered inline ${h(plan.report_sha256)}, current with the plan  $ shrine-check --render report` : 'the plan changed since the inline report: render it again and record the new hash'] };
	}
	if (!isObj(r) || !isStr(r.file)) return { mark: ' ', lines: ['plan.report_file missing: run --render report --out <t>, show the short block, and record its file and sha256'] };
	const path = ctx.rp(r.file);
	const text = readText(path ?? '');
	if (text == null) return { mark: ' ', lines: [`report file ${r.file} not found`] };
	let mark = 'x';
	if (sha(text) !== r.sha256) {
		mark = ' ';
		lines.push(`report file ${path} ${h(sha(text))} != recorded ${h(r.sha256)}`);
	}
	if (text !== `${reportLines(plan, man, ctx, path).join('\n')}\n`) {
		mark = ' ';
		lines.push(`${path} no longer matches the plan or the files: render the inspection report again`);
	}
	for (const p of [...outsideProblems('report', path, plan), ...reportProblems(text)]) {
		mark = ' ';
		lines.push(p);
	}
	if (mark === 'x') lines.push(`${path} ${h(r.sha256)}: current, outside every scope root and repo, every line filled  $ shrine-check --render report`);
	return { mark, lines };
}

function renderFinal(ctx, man, planPath) {
	const { plan } = ctx;
	const all = [];
	const body = [];
	for (const g of GATES) {
		body.push(`-- Gate ${g.n}: ${g.name}`);
		for (const [id, title] of g.items) {
			const r = renderItem(id, title, ctx);
			all.push([id, r.mark]);
			body.push(...r.out);
		}
	}
	body.push('-- Phase 4: Report');
	const item = (id, mark, lines) => {
		all.push([id, mark]);
		const title = FINAL_ITEMS.find((i) => i[0] === id)[1];
		body.push(`${MARKS[mark]} ${id} ${title}: ${lines[0]}`, ...lines.slice(1).map((l) => `      ${l}`));
	};
	const v = ctx.verify;
	item('4.1', v.problems.length ? ' ' : 'x', [v.problems.length ? `FAIL: ${v.problems.length} changes since the baseline` : `PASS: no change; ${v.summary}  $ shrine-check --verify-readonly`, ...v.problems, ...v.notes.map((n) => `note: ${n}`)]);
	const rf = reportFileItem(ctx, man);
	item('4.2', rf.mark, rf.lines);
	const sa = renderItem('4.3', 'Self-audit', ctx);
	all.push(['4.3', sa.mark]);
	body.push(...sa.out);
	const rep = runChecks(plan, man, { ...ctx, planPath });
	const markOf = (id) => (id === '4.5' ? (rep.failed ? ' ' : 'x') : all.find((a) => a[0] === id)?.[1] ?? ' ');
	const inv = INVARIANTS.map(([name, ids]) => ({ ok: ids.every((id) => ['x', '-'].includes(markOf(id))), line: `${name}: ${ids.map((id) => `${id}${MARKS[markOf(id)]}`).join(' ')}` }));
	item('4.4', inv.every((i) => i.ok) ? 'x' : ' ', [`${inv.filter((i) => i.ok).length} of ${INVARIANTS.length} invariants with every item [x] or [-]  $ shrine-check (marks in this gate)`, ...inv.map((i) => i.line)]);
	item('4.5', rep.failed ? ' ' : 'x', [rep.result(), ...rep.lines, `$ node shrine-check.mjs --check --plan ${planPath ?? '-'} --manifest ${man.src}`]);
	const shown = shownLine(3, ctx);
	const blocked = all.some(([, m]) => m === ' ' || m === 'wait');
	const status = blocked || shown ? 'BLOCKED' : 'PASS';
	return { status, marks: all.map(([, m]) => m), lines: [`FINAL GATE: ${status}`, plan.mode === 'report-only' ? 'Approved: report-only' : 'Approved: none needed', header(plan), ...(shown ? [shown] : []), ...body, `FINAL GATE is ${status}: ${status === 'PASS' ? 'every item is [x] or [-] with a reason' : 'fix each [ ] item, or report it as a gap'}.`] };
}

function pinLines(plan, man) {
	const m = man.data;
	const titles = arr(plan.pages).filter(isObj).map((p) => p.title);
	const mp = new Map(arr(m.pages).filter(isObj).map((p) => [p.title, p.sha256]));
	return [
		`commit ${m.commit}`,
		`prompt version ${m.prompt?.version}; prompt ${h(m.prompt?.sha256)}`,
		`checker ${h(m.checker?.sha256)}`,
		`manifest ${siteBase(man)}shrine-manifest.json`,
		`${titles.length} pages read`,
		...titles.map((t) => `  "${t}" ${mp.has(t) ? h(mp.get(t)) : 'not in manifest'}`),
	];
}

// ---------- render output: in full, or to a file with a short block ----------

function outDir(opts, plan) {
	const dir = realish(resolve(expandHome(opts.out)));
	let isDir = false;
	try {
		isDir = statSync(dir).isDirectory();
	} catch {}
	if (!isDir) throw new Error(`--out ${opts.out} is not an existing folder: create the run's temporary folder first`);
	if (!isStr(plan.out_dir) || realish(expandHome(plan.out_dir)) !== dir) throw new Error(`--out ${dir} is not the plan's out_dir (${plan.out_dir}): every render goes in the run's temporary folder`);
	const probs = outsideProblems('--out', dir, plan);
	if (probs.length) throw new Error(probs.join('; '));
	return dir;
}

// A new file, never an existing one; an identical render reuses its file.
function freePath(dir, slug, ext, text) {
	const taken = new Set(readdirSync(dir));
	for (let n = 1; ; n++) {
		const name = `${slug}-${n}${ext}`;
		const path = join(dir, name);
		if (!taken.has(name)) return { path, fresh: true };
		if (text != null && fileSha(path) === sha(text)) return { path, fresh: false };
	}
}

function emit(kind, body, opts, plan, summary) {
	const text = renderText(kind, body);
	if (!opts.out) {
		process.stdout.write(text);
		return;
	}
	const { path, fresh } = freePath(outDir(opts, plan), kind.replace(/\s+/g, '-'), '.txt', text);
	if (fresh) writeFileSync(path, text, { flag: 'wx' });
	console.log([
		`--- shrine-check ${VERSION} short ${kind} (paste verbatim; the full render is in the file) ---`,
		...summary,
		`render file: ${path}`,
		`render sha256:${sha(text)}`,
		`--- end short ${kind} sha256:${sha(text)} ---`,
	].join('\n'));
}

const markCounts = (marks) => {
	const n = (m) => marks.filter((x) => x === m).length;
	return `counts: ${n('x')} [x], ${n('-')} [-], ${n(' ')} [ ], ${n('wait')} awaiting`;
};

// ---------- main ----------

async function render(opts) {
	const pf = loadPlan(opts.plan);
	const plan = pf.data;
	const shape = planShape(plan);
	if (shape.length) {
		console.error(`shrine-check: plan ${opts.plan} is malformed:\n${shape.map((s) => `  - ${s}`).join('\n')}`);
		return 2;
	}
	const ctx = { plan, rp: planResolver(plan), planPath: pf.path };
	const man = opts.manifest ? await loadManifest(opts.manifest) : null;
	ctx.man = man;
	if (opts.render === 'time') {
		const t = plan.time;
		const now = nowSec();
		const used = Math.floor((now - t.start) / 60);
		const lines = [
			`time used: ${used} of ${t.agreed} min; ${used > t.agreed ? `${used - t.agreed} min over: ask whether to continue or stop` : `${t.agreed - used} min left`}`,
			`started ${isoOf(t.start)}; now ${isoOf(now)} (UTC, checker clock)`,
			`source: checker clock minus time.start from ${t.start_source}`,
		];
		emit('time', lines, opts, plan, [lines[0]]);
		return 0;
	}
	if (opts.render === 'baseline') {
		if (!opts.out && plan.delivery !== 'inline') throw new Error('--render baseline needs --out (file delivery): the baseline is a file the read-only check compares against');
		const roots = baselineRoots(plan);
		const lines = baselineLines(plan, roots);
		const b = parseBaseline(lines);
		const head = [`BASELINE: ${countsText(baselineCounts(b))}`, ...[...b.wcap].map(([d, c]) => `FAIL ${capProblem(d, c)}`)];
		if (opts.out) {
			emit('baseline', lines, opts, plan, [...head, 'Record this file and its sha256 in plan.readonly.baselines.']);
			return 0;
		}
		// Inline: print a digest and counts, not every file hash, for the agent to record in the plan.
		const entry = { inline: true, ...digestOf(lines), counts: baselineCounts(b), roots };
		const body = [...head, `entry: ${JSON.stringify(entry)}`, 'Add the entry line\'s JSON to plan.readonly.baselines.'];
		console.log([`--- shrine-check ${VERSION} short baseline (inline: paste verbatim) ---`, ...body, `--- end short baseline sha256:${sha(body.join('\n'))} ---`].join('\n'));
		return 0;
	}
	if (opts.render === 'review') {
		const lines = proposalsOf(plan).map((x) => {
			const { current, stale, design, rounds } = reviewersOf(x);
			return `${x.id} design sha256:${design}; risk ${riskOf(x)}; ${current.length} of at least ${MIN_REVIEWERS[riskOf(x)]} reviewers of this design; round ${rounds} of at most ${MAX_ROUNDS}${stale ? `; ${stale} reviewed an earlier design` : ''}${isStr(x.review?.self_only) ? '; self only' : ''}`;
		});
		emit('review', lines, opts, plan, [`REVIEW: ${lines.length} changes; ${proposalsOf(plan).filter((x) => reviewProblems(x, plan.mode).length).length} need review or escalation`]);
		return 0;
	}
	if (opts.render === 'coverage') {
		const p = coverageProblems(plan, man.data);
		const rows = coverageRows(plan, man);
		emit('coverage', [...rows, ...p.map((x) => `FAIL ${x}`)], opts, plan, [`COVERAGE: ${p.length ? 'FAIL' : 'PASS'}; ${rows[0]}`]);
		return p.length ? 1 : 0;
	}
	if (opts.render === 's1') {
		emit('s1', s1Lines(man), opts, plan, ['S1: put these lines verbatim in the S1 change; the checker confirms the change holds every line']);
		return 0;
	}
	if (opts.render === 'pin') {
		const lines = pinLines(plan, man);
		emit('pin', lines, opts, plan, [`PIN: ${lines[0]}; ${lines[4]}`]);
		return 0;
	}
	if (opts.render === 'refresh') {
		const r = refreshLines(plan, man);
		emit('refresh', r.lines, opts, plan, [`REFRESH: ${r.ok ? r.lines[1] : r.lines[0]}`, ...(r.ok ? [r.lines[3]] : [])]);
		return r.ok ? 0 : 1;
	}
	ctx.verify = verifyReadonly(plan);
	ctx.results = patchResults(plan);
	if (opts.render === 'report') {
		if (opts.out) {
			const dir = outDir(opts, plan);
			let pick = freePath(dir, 'shrine-report', '.md', null);
			let text = `${reportLines(plan, man, ctx, pick.path).join('\n')}\n`;
			// An identical report already written keeps its file.
			for (let n = 1; ; n++) {
				const path = join(dir, `shrine-report-${n}.md`);
				if (path === pick.path) break;
				const same = `${reportLines(plan, man, ctx, path).join('\n')}\n`;
				if (fileSha(path) === sha(same)) {
					pick = { path, fresh: false };
					text = same;
					break;
				}
			}
			if (pick.fresh) writeFileSync(pick.path, text, { flag: 'wx' });
			const p = reportProblems(text);
			console.log([
				`--- shrine-check ${VERSION} short report (paste verbatim; the full report is in the file) ---`,
				`REPORT: ${p.length ? `${p.length} lines not filled` : 'complete'}; ${proposalsOf(plan).length} changes; read-only check ${ctx.verify.problems.length ? 'FAIL' : 'PASS'}`,
				...p,
				`report file: ${pick.path}`,
				'Offer to show it. Record its file and sha256 in plan.report_file.',
				`render sha256:${sha(text)}`,
				`--- end short report sha256:${sha(text)} ---`,
			].join('\n'));
			return p.length ? 1 : 0;
		}
		const text = `${reportLines(plan, man, ctx, `(inline: ${plan.delivery_reason ?? 'no file'})`).join('\n')}\n`;
		process.stdout.write(`--- shrine-check ${VERSION} report (paste verbatim) ---\n${text}--- end report sha256:${sha(text)} ---\n`);
		return reportProblems(text).length ? 1 : 0;
	}
	if (opts.render === 'final') {
		const f = renderFinal(ctx, man, pf.path);
		const open = f.lines.filter((l) => /^\[ \] /.test(l)).map((l) => l.split(':')[0].slice(4));
		emit('final', f.lines, opts, plan, [`FINAL GATE: ${f.status}`, markCounts(f.marks), ...(open.length ? [`open items: ${open.join(', ')}`] : [])]);
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
	try {
		if (opts.render) return await render(opts);
		const pf = loadPlan(opts.plan);
		const plan = pf.data;
		if (opts.verify) {
			const shape = planShape(plan);
			if (shape.length) {
				console.error(`shrine-check: plan ${opts.plan} is malformed:\n${shape.map((s) => `  - ${s}`).join('\n')}`);
				return 2;
			}
			const v = verifyReadonly(plan);
			console.log([`shrine-check ${VERSION} --verify-readonly: ${v.problems.length ? 'FAIL' : 'PASS'} (${v.summary})`, ...v.problems.map((p) => `  - ${p}`), ...v.notes.map((n) => `  note: ${n}`)].join('\n'));
			return v.problems.length ? 1 : 0;
		}
		const man = await loadManifest(opts.manifest);
		const rep = runChecks(plan, man, { planPath: pf.path });
		console.log([`shrine-check ${VERSION} (changes nothing)`, `manifest: ${opts.manifest} ${h(man.hash)}`, ...rep.lines, rep.result()].join('\n'));
		return rep.failed ? 1 : 0;
	} catch (err) {
		console.error(`shrine-check: ${err.message}`);
		return 2;
	}
}

process.exitCode = await main();
