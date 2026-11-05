// `run --tier T0`: setup scan, gates, findings, report. Each phase writes its
// output then a <phase>.done marker; a resumed run skips finished phases.
import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import { exists, readJson, resetSpy, spyLog } from '../io/fsread.mjs';
import { createRunFolder, runFolder } from '../io/runfolder.mjs';
import { appDirs } from '../io/paths.mjs';
import { firstSafeGit, gitRefusals, gitTimeouts, gitVersion, globalHang, historyReadable, isHung, isRefused, resetGitTimeouts } from '../io/git.mjs';
import { spawnTimeoutMs } from '../io/proc.mjs';
import { detect } from '../adapters/claude-code/detect.mjs';
import { defaultTempPatterns, encodeProjectPath, listProjects } from '../adapters/claude-code/projects.mjs';
import { retention } from '../adapters/claude-code/retention.mjs';
import { collectSetup, knownIdentifiers } from '../adapters/claude-code/setup.mjs';
import { runConfigProbes } from '../probes/config.mjs';
import { score, displayPath, TOOL_VERSION } from '../scorer/score.mjs';
import { copy, copyVocabulary } from '../copy/templates.mjs';
import { loadBundledCatalogue } from '../catalogue/build.mjs';
import { renderReport, shareSafeFindings } from '../render/report.mjs';
import { buildIdentifiers } from '../scrub/mask.mjs';
import { diffLine, diffRuns, previousFindings } from '../diff/previous.mjs';
import { assertValid } from '../schema/validate.mjs';
import { factsSchema } from '../schema/facts.mjs';
import { findingsSchema } from '../schema/findings.mjs';
import { fileURLToPath } from 'node:url';
import { baselineOf, verifyRun } from '../verify/verify.mjs';
import { InspectError, EXIT } from './errors.mjs';
import { askGate, GATE_A, GATE_B_NOTE } from './approve.mjs';
import { estimateSeconds, scanHistory } from './scan.mjs';
import { ownSession } from '../adapters/claude-code/sessions.mjs';
import { freezeListing } from '../adapters/claude-code/projects.mjs';
import { tierProposal } from '../scorer/stats.mjs';

const PIVOTS = readJson(fileURLToPath(new URL('../catalogue/generic-pivots.json', import.meta.url)));
const KINDS = readJson(fileURLToPath(new URL('../catalogue/t0-kinds.json', import.meta.url)));

export function context(io) {
  const now = io.env.SHRINE_INSPECT_NOW ? Date.parse(io.env.SHRINE_INSPECT_NOW) : Date.now();
  return { dirs: appDirs({ env: io.env, home: io.home }), home: io.home, now };
}

// Run ids sort by wall-clock creation time (ms), so "previous run" is well defined
// even when SHRINE_INSPECT_NOW pins the analysis clock.
let lastIdMs = 0;
function newRunId() {
  const ms = Math.max(Date.now(), lastIdMs + 1);
  lastIdMs = ms;
  const t = new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '');
  return `${t}-${randomBytes(2).toString('hex')}`;
}

export async function runCommand(opts, io) {
  if (opts.tier !== 'T0') {
    throw new InspectError('E_TIER', `tier ${opts.tier ?? '(none)'} is not available in this version`, { hint: 'use --tier T0', exit: EXIT.USAGE });
  }
  resetSpy();
  resetGitTimeouts();
  const ctx = context(io);
  const d = detect({ home: ctx.home });
  if (!d.present) throw new InspectError('E_NO_HARNESS', `no Claude Code folder at ${displayPath(d.claude_home, ctx.home)}`, { hint: 'run inspect as the user whose setup you want to check' });
  const runId = newRunId();
  const folder = createRunFolder(ctx.dirs.state, runId);
  const at = new Date(ctx.now).toISOString();
  const state = {
    run_id: runId,
    tier: 'T0',
    started_at: at,
    session_id: opts.sessionId ?? null,
    // Gate B: T0 is the only tier in this version, chosen by --tier on the command line.
    gates: { A: opts.noHistory ? { choice: 'no-history', by: 'flag', at } : null, B: { choice: 'T0', by: 'flag', at } },
  };
  folder.writeJson('state.json', state);
  return continueRun(folder, ctx, io);
}

export function findRun(stateDir, runId) {
  const dir = join(stateDir, 'runs', runId);
  if (!/^[\w-]+$/.test(runId) || !exists(join(dir, 'state.json'))) {
    throw new InspectError('E_NO_RUN', `no run ${runId}`, { hint: 'run ids are printed by `shrine-inspect run`', exit: EXIT.USAGE });
  }
  return runFolder(dir);
}

export async function continueRun(folder, ctx, io) {
  const state = readJson(folder.path('state.json'));
  const ret = retention({ home: ctx.home });
  const claudeHome = detect({ home: ctx.home }).claude_home;
  // The scope is frozen when Gate A is first shown: a run resumed later by
  // `approve` reads exactly the session files that were itemized, with the same
  // own-session decision (false means none), never files that appeared since.
  const frozen = state.frozen ?? null;
  let listing = listProjects({ claudeHome, now: frozen?.now ?? ctx.now, windowDays: ret.days, tempPatterns: defaultTempPatterns(io.env) });
  if (frozen) listing = freezeListing(listing, new Set(frozen.files));
  else {
    state.frozen = { now: ctx.now, files: [...listing.projects, ...listing.excluded].flatMap((p) => (p.files ?? []).map((f) => f.path)) };
    state.own = ownSession(listing, { sessionId: state.session_id, now: ctx.now }) ?? false;
  }
  const historyBytes = listing.projects.reduce((n, p) => n + (p.bytes_with_subagents ?? p.bytes), 0);
  const itemized = {
    projects: listing.projects.length,
    sessions: listing.projects.reduce((n, p) => n + p.sessions, 0),
    from: listing.projects.length ? listing.projects.map((p) => p.first_mtime).sort()[0] : null,
    to: listing.projects.length ? listing.projects.map((p) => p.last_mtime).sort().at(-1) : null,
    bytes: historyBytes,
    estimate_seconds: estimateSeconds(historyBytes),
    window_days: ret.days,
    recheck_sessions: listing.excluded.filter((e) => e.reason === 'automation' || e.reason === 'temp').reduce((n, e) => n + e.sessions, 0),
  };

  if (!state.gates.A) {
    const gate = {
      gate: 'A',
      ...GATE_A,
      projects: listing.top.map((p) => ({ name: p.name, sessions: p.sessions, bytes: p.bytes })),
      more: listing.more,
      excluded: listing.excluded.length,
      history: itemized,
      own_session: state.own ? { id: state.own.id, project: state.own.project, reason: state.own.reason } : null,
      tier: { offered: 'T0', note: GATE_B_NOTE },
    };
    folder.writeJson('gate.json', gate);
    state.phase = 'gate_a';
    folder.writeJson('state.json', state);
    if (!io.stdin.isTTY) {
      throw new InspectError('E_GATE_WAITING', `run ${state.run_id} is paused at Gate A (history: yes or no)`, {
        hint: `answer in your own terminal: shrine-inspect approve ${state.run_id} A <no-history|history>`,
        exit: EXIT.GATE_WAITING,
      });
    }
    state.gates.A = await askGate(gate, null, io);
    folder.writeJson('state.json', state);
  }

  const historyConsented = state.gates.A.choice === 'history';
  const scope = listing.projects;
  const projects = scope.map((p) => ({ root: p.root, cwds: p.cwds }));
  const display = (p) => displayPath(p, ctx.home);
  const excludedIds = state.own ? [state.own.id] : [];

  // Phase: history (only after Gate A says yes). Repo HEADs are read before setup's
  // own git runs, and setup before the scan, so the verify step sees a lazy fetch
  // from a setup git run and a config write or HEAD move during the scan.
  const { heads } = baselineOf([], projects.map((p) => p.root));
  const setup = collectSetup({ home: ctx.home, projects, now: ctx.now });
  const history = historyConsented ? await scanHistory({ listing, excludedIds, display, onProgress: io.onScanProgress }) : null;
  const usage = history && !history.unsupported && history.sessions.length > 0 ? history.usage : null;

  const run = {
    id: state.run_id,
    started_at: state.started_at,
    tool_version: TOOL_VERSION,
    harness: { name: 'Claude Code', version: history?.inventory.harness_version ?? null },
    scope: { projects: scope.map((p) => p.name), from: history?.inventory.from ?? null, to: history?.inventory.to ?? null, history_consented: historyConsented },
    win_definition: null,
    seed: null,
  };
  const catalogue = loadBundledCatalogue();
  const shrine = { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null };

  // Phase: scan (config probes over the setup read before history).
  const probes = runConfigProbes(setup);
  if (!folder.isDone('scan')) {
    folder.writeJson('scan.json', {
      schema_version: 1,
      run_id: state.run_id,
      projects: listing.projects.map((p) => ({ name: p.name, sessions: p.sessions, bytes: p.bytes, first_mtime: p.first_mtime, last_mtime: p.last_mtime })),
      more: listing.more,
      excluded: listing.excluded.map((e) => ({ reason: e.reason, cwd: e.cwd ? displayPath(e.cwd, ctx.home) : null, sessions: e.sessions })),
      retention: ret,
      probes: probes.probes.map((p) => ({ kind: p.kind, entry_id: p.entry_id, hit: p.hit, metric: p.metric })),
      structure: probes.structure.map((s) => ({ check: s.check, applicable: s.applicable, pass: s.pass })),
      history: { consented: historyConsented, ...itemized, rule: usage?.rule ?? (historyConsented ? 'setup_only' : null), usage_kinds: usage ? usage.kinds.map((k) => ({ kind: k.kind, ship: k.ship, applicable: k.applicable, hit: k.hit, metric: k.metric })) : [] },
      tier_proposal: tierProposal(),
    });
    folder.markDone('scan');
  }

  // Phase: facts.
  const counts = (kind) => setup.items.filter((i) => i.kind === kind).length;
  if (!folder.isDone('facts')) {
    const facts = {
      schema_version: 1,
      run,
      shrine,
      config: setup.items.map((i) => ({
        id: i.id,
        path_scrubbed: displayPath(i.path, ctx.home),
        kind: i.kind,
        layer: i.layer,
        source: i.source,
        bytes: i.bytes,
        mtime: i.mtime,
        sha256: i.sha256,
        loaded_by: i.loaded_by,
      })),
      repos: projects.map((p) => ({ id: basename(p.root), commits_in_window: 0, commits_before_window: 0, reverts: [], fixups: [], test_command_present: null, work_left_open: [] })),
      sessions: usage ? history.sessions : [],
      episodes: usage ? history.episodes : [],
      metrics: usage ? { usage: usage.counts, automation: usage.automation, rule: usage.rule } : {},
      setup: { always_loaded_bytes: setup.always_loaded.max_bytes, retention: ret, consent: state.gates.A },
      consent: { A: state.gates.A, B: state.gates.B ?? null, itemized, excluded_session_ids: excludedIds },
    };
    folder.writeJson('facts.json', assertValid(factsSchema, facts, 'facts.json'));
    folder.markDone('facts');
  }

  // Phase: findings.
  const findings = score({
    run,
    shrine,
    probes: probes.probes,
    structure: probes.structure,
    catalogue,
    pivots: PIVOTS,
    copy,
    home: ctx.home,
    history: { consented: historyConsented, read: Boolean(usage), sessions: usage ? usage.counts.sessions : null },
    usage,
    usageKinds: KINDS.usage_kinds,
    sessionStarts: usage ? history.sessions.map((s) => ({ start: s.start, root: history.roots.get(s.id) })) : null,
    projectScopes: projects.map((p) => ({
      root: p.root,
      memory_dirs: [...new Set([p.root, ...(p.cwds ?? [])])].map((cwd) => join(claudeHome, 'projects', encodeProjectPath(cwd), 'memory')),
      loaded: (setup.always_loaded.by_project.find((b) => b.project === p.root)?.files ?? []).map((f) => f.path),
    })),
    userLoaded: setup.always_loaded.user_files.map((f) => f.path),
    inventoryCounts: {
      hooks: counts('hook'),
      skills: counts('skill'),
      agents: counts('agent'),
      commands: counts('command'),
      servers: setup.items.filter((i) => i.kind === 'server' && i.virtual).length,
      'memory files': counts('memory'),
      'instruction files': counts('instruction'),
      plugins: setup.inventory.enabled_plugins.length,
    },
  });
  // Run limits: what this run could not read. Shown near the top of the report, and
  // kept in notes for readers of findings.json.
  const limits = [];
  // A repo where git hung or was refused is reported as that, not as a partial clone.
  const noHistory = projects.filter((p) => !isHung(p.root) && !isRefused(p.root) && !historyReadable(p.root)).length;
  if (noHistory) {
    const v = gitVersion()?.join('.') ?? 'unknown';
    limits.push(`Git history was not read in ${noHistory === 1 ? '1 repo' : `${noHistory} repos`}: a partial clone, and git ${v} can fetch missing objects while reading it. Git dates there were not used, and the stale-file and review-date checks skip those files. Commit authors there are not read; the names and emails your git config files set, with every file they include, are still masked. Git ${firstSafeGit(gitVersion())} or later reads them safely.`);
    findings.git_history_skipped = noHistory;
  }
  const hung = gitTimeouts().length;
  const secs = spawnTimeoutMs() / 1000;
  if (globalHang()) {
    limits.push(`Git did not finish within ${secs === 1 ? '1 second' : `${secs} seconds`} reading your global git config and was stopped, so git was not run again: no git dates or history in any repo. Global config that blocks git (an include.path naming a pipe, for one) causes this.`);
  } else if (hung) {
    limits.push(`Git did not finish within ${secs === 1 ? '1 second' : `${secs} seconds`} in ${hung === 1 ? '1 repo' : `${hung} repos`} and was stopped. Git reads there count as failed: no git dates or history. Repo config that blocks git (an include.path naming a pipe, for one) causes this.`);
  }
  const refused = gitRefusals().length;
  if (refused) {
    limits.push(`Git refused to read ${refused === 1 ? '1 repo' : `${refused} repos`} owned by another user (git's safe.directory check). Git dates and commit authors there are unknown, and date checks skip those files.`);
  }
  // Identifiers for the share-safe copy, read now so a git config file it could not
  // read in full shows as a run limit.
  const ids = knownIdentifiers({ home: ctx.home, projects, env: io.env });
  const unreadCfg = ids.unread_configs.length;
  if (unreadCfg) {
    limits.push(`${unreadCfg === 1 ? '1 git config file was' : `${unreadCfg} git config files were`} not read in full (not a regular file, unreadable, or over 1 MiB). Names and emails set there, past that point, are not masked in the share-safe copy.`);
  }
  if (limits.length) {
    findings.run_limits = limits;
    findings.notes.push(...limits);
  }
  if (history) findings.skipped_files = history.skipped_files;
  if (history?.unsupported) findings.notes = ['Session logs were approved but none could be parsed, so this report covers setup only.'];
  findings.diff = diffRuns(previousFindings(ctx.dirs.state, state.run_id), findings);

  // Phase: verify (runtime hash check of every file opened, before the report so
  // a failure shows as the integrity banner). Session logs only record growth.
  const base = baselineOf(setup.items);
  const logs = new Map(spyLog().filter((e) => e.stream).map((e) => [e.path, { path: e.path, size: e.size, mtime_ms: null, append_only: true }]));
  const verify = verifyRun({ files: [...base.files, ...logs.values()], heads }, spyLog());
  findings.integrity = { ok: verify.ok, changed_paths: verify.changed_paths.map((p) => displayPath(p, ctx.home)) };
  folder.writeJson('verify.json', {
    schema_version: 1,
    run_id: state.run_id,
    ...verify,
    changed_paths: findings.integrity.changed_paths,
    changed_by_others: verify.changed_by_others.map((c) => ({ ...c, path: displayPath(c.path, ctx.home) })),
    excluded_session_ids: excludedIds,
  });
  folder.markDone('verify');

  assertValid(findingsSchema, findings, 'findings.json');
  folder.writeJson('findings.json', findings);
  folder.markDone('findings');

  // Phase: report.
  const known = buildIdentifiers({ ...ids, vocabulary: copyVocabulary() });
  const reportPath = folder.write('report.html', renderReport(findings));
  const safePath = folder.write('report.share-safe.html', renderReport(shareSafeFindings(findings, known, PIVOTS), { shareSafe: true }));
  folder.markDone('report');

  state.phase = 'done';
  folder.writeJson('state.json', state);
  folder.write('spy.jsonl', `${spyLog().map((e) => JSON.stringify(e)).join('\n')}\n`);

  const summary = { run_id: state.run_id, run_dir: folder.dir, report: reportPath, share_safe: safePath, diff: findings.diff, findings: findings.findings.length, checked_clear: findings.checked_clear.length };
  if (io.json) io.stdout.write(`${JSON.stringify(summary)}\n`);
  else {
    if (findings.diff) io.stdout.write(`${diffLine(findings.diff)}\n`);
    io.stdout.write(`Report: ${reportPath}\nShare-safe copy: ${safePath}\n`);
  }
  const code = !findings.integrity.ok ? EXIT.INTEGRITY : history?.unsupported ? EXIT.UNSUPPORTED_FORMAT : EXIT.OK;
  return { code, summary, folder };
}
