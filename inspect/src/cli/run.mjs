// `run --tier T0`: setup scan, gates, findings, report. Each phase writes its
// output then a <phase>.done marker; a resumed run skips finished phases.
import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import { exists, readJson, resetSpy, spyLog } from '../io/fsread.mjs';
import { createRunFolder, runFolder } from '../io/runfolder.mjs';
import { appDirs } from '../io/paths.mjs';
import { detect } from '../adapters/claude-code/detect.mjs';
import { defaultTempPatterns, listProjects } from '../adapters/claude-code/projects.mjs';
import { retention } from '../adapters/claude-code/retention.mjs';
import { collectSetup, knownIdentifiers } from '../adapters/claude-code/setup.mjs';
import { runConfigProbes } from '../probes/config.mjs';
import { score, displayPath, TOOL_VERSION } from '../scorer/score.mjs';
import { copy } from '../copy/templates.mjs';
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
import { askGate, GATE_A } from './approve.mjs';

const PIVOTS = readJson(fileURLToPath(new URL('../catalogue/generic-pivots.json', import.meta.url)));

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
  const ctx = context(io);
  const d = detect({ home: ctx.home });
  if (!d.present) throw new InspectError('E_NO_HARNESS', `no Claude Code folder at ${displayPath(d.claude_home, ctx.home)}`, { hint: 'run inspect as the user whose setup you want to check' });
  const runId = newRunId();
  const folder = createRunFolder(ctx.dirs.state, runId);
  const state = {
    run_id: runId,
    tier: 'T0',
    started_at: new Date(ctx.now).toISOString(),
    gates: { A: opts.noHistory ? { choice: 'no-history', by: 'flag', at: new Date(ctx.now).toISOString() } : null },
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
  const listing = listProjects({ claudeHome, now: ctx.now, windowDays: ret.days, tempPatterns: defaultTempPatterns(io.env) });

  if (!state.gates.A) {
    const gate = { gate: 'A', ...GATE_A, projects: listing.top.map((p) => ({ name: p.name, sessions: p.sessions, bytes: p.bytes })), more: listing.more, excluded: listing.excluded.length };
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
  const run = {
    id: state.run_id,
    started_at: state.started_at,
    tool_version: TOOL_VERSION,
    harness: { name: 'Claude Code', version: null },
    scope: { projects: scope.map((p) => p.name), from: null, to: null, history_consented: historyConsented },
    win_definition: null,
    seed: null,
  };
  const catalogue = loadBundledCatalogue();
  const shrine = { commit: catalogue.shrine.commit, manifest_sha: null, fetched_at: null };

  // Phase: scan (setup, config probes).
  const setup = collectSetup({ home: ctx.home, projects, now: ctx.now });
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
      tier_proposal: 'T0',
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
      sessions: [],
      episodes: [],
      metrics: {},
      setup: { always_loaded_bytes: setup.always_loaded.max_bytes, retention: ret, consent: state.gates.A },
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
    history: { consented: historyConsented, read: false, sessions: null },
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
  if (historyConsented) findings.notes.push('Session history was approved, but this version reads setup only; usage counts arrive in a later version.');
  findings.diff = diffRuns(previousFindings(ctx.dirs.state, state.run_id), findings);

  // Phase: verify (runtime hash check of every file opened, before the report so
  // a failure shows as the integrity banner).
  const verify = verifyRun(baselineOf(setup.items, projects.map((p) => p.root)), spyLog());
  findings.integrity = { ok: verify.ok, changed_paths: verify.changed_paths.map((p) => displayPath(p, ctx.home)) };
  folder.writeJson('verify.json', { schema_version: 1, run_id: state.run_id, ...verify, changed_paths: findings.integrity.changed_paths, changed_by_others: verify.changed_by_others.map((c) => ({ ...c, path: displayPath(c.path, ctx.home) })) });
  folder.markDone('verify');

  assertValid(findingsSchema, findings, 'findings.json');
  folder.writeJson('findings.json', findings);
  folder.markDone('findings');

  // Phase: report.
  const known = buildIdentifiers(knownIdentifiers({ home: ctx.home, projects }));
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
  return { code: findings.integrity.ok ? EXIT.OK : EXIT.INTEGRITY, summary, folder };
}
