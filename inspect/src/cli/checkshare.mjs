// `check-share`: checks a share-safe report against what this machine knows.
// Read-only, no network. Needles: the identifiers the share-safe copy masks
// (OS user, home, git authors, project, repo, and org names, read again the
// way the run read them), the run's project folders, and the session excerpts
// of the local findings, which the share-safe copy drops. A control runs the
// same name check on the local report, so a pass is shown to be able to fail.
import { basename, dirname, join } from 'node:path';
import { exists, readJson, readText } from '../io/fsread.mjs';
import { detect } from '../adapters/claude-code/detect.mjs';
import { retention } from '../adapters/claude-code/retention.mjs';
import { defaultTempPatterns, freezeListing, listProjects } from '../adapters/claude-code/projects.mjs';
import { knownIdentifiers } from '../adapters/claude-code/setup.mjs';
import { leaks } from '../verify/leak.mjs';
import { InspectError, EXIT } from './errors.mjs';
import { newestRun } from './background.mjs';

// Excerpts shorter than this may equal the report's own words; they are not needles.
const MIN_EXCERPT = 24;

// Session text the local report shows and the share-safe copy must not.
export function excerptsOf(findings) {
  const out = new Set();
  const add = (s) => {
    if (typeof s === 'string' && s.trim().length >= MIN_EXCERPT) out.add(s.trim());
  };
  for (const f of [...(findings.findings ?? []), ...(findings.worth_a_look ?? [])]) {
    for (const e of f.evidence ?? []) add(e.excerpt_scrubbed);
    if (f.pivot?.source === 'user_prompt') {
      add(f.pivot.before_scrubbed);
      add(f.pivot.after_scrubbed);
    }
    for (const e of f.episode_ref?.timeline ?? []) add(e.label_scrubbed);
  }
  return [...out];
}

// The run folder and the share-safe file to check. target: a run id, a path to
// a share-safe file (its own run folder when it sits in one, else the newest
// run), or nothing (the newest run's share-safe file).
function resolve(target, ctx, findRun) {
  if (target && /\.html?$/i.test(target)) {
    if (!exists(target)) throw new InspectError('E_NO_FILE', `no file ${target}`, { hint: 'pass the share-safe report, or a run id', exit: EXIT.USAGE });
    const dir = dirname(target);
    const own = exists(join(dir, 'state.json')) && exists(join(dir, 'report.html'));
    return { folder: own ? findRun(join(dir, '..', '..'), basename(dir)) : findRun(ctx.dirs.state, newestRun(ctx.dirs.state)), file: target };
  }
  const folder = findRun(ctx.dirs.state, target ?? newestRun(ctx.dirs.state));
  return { folder, file: folder.path('report.share-safe.html') };
}

export function checkShareCommand({ target }, io, { findRun, context }) {
  const ctx = context(io);
  const { folder, file } = resolve(target, ctx, findRun);
  if (!exists(folder.path('findings.json')) || !exists(folder.path('report.html')) || !exists(file)) {
    throw new InspectError('E_NOT_DONE', 'this run has no report yet', { hint: 'check a finished run: shrine-inspect status', exit: EXIT.USAGE });
  }
  const state = readJson(folder.path('state.json'));
  const findings = readJson(folder.path('findings.json'));

  // The run's projects, listed the way the run listed them.
  const claudeHome = detect({ home: ctx.home }).claude_home;
  const ret = retention({ home: ctx.home });
  const frozen = state.frozen ?? null;
  let listing = listProjects({ claudeHome, now: frozen?.now ?? ctx.now, windowDays: ret.days, tempPatterns: defaultTempPatterns(io.env) });
  if (frozen) listing = freezeListing(listing, new Set(frozen.files));
  const scope = new Set(findings.run?.scope?.projects ?? []);
  const projects = listing.projects.filter((p) => scope.has(p.name)).map((p) => ({ root: p.root, cwds: p.cwds }));
  const ids = knownIdentifiers({ home: ctx.home, projects, env: io.env });

  const names = [...new Set([...ids.authors.flatMap((a) => [a.name, a.email]), ...ids.projects, ...ids.repos, ...ids.orgs, ...scope].filter((n) => typeof n === 'string' && n.length >= 2))];
  const paths = [...new Set([ctx.home, ...projects.map((p) => p.root)].filter(Boolean))];
  const prompts = excerptsOf(findings);
  const found = leaks(readText(file), { names, paths, prompts, user: ids.osUser });
  const control = leaks(readText(folder.path('report.html')), { names }).filter((x) => x.startsWith('name: '));

  const summary = { run_id: state.run_id, file, ok: found.length === 0, found, checked: { names: names.length, paths: paths.length, excerpts: prompts.length, os_user: Boolean(ids.osUser) }, control: control.length };
  if (io.json) io.stdout.write(`${JSON.stringify(summary)}\n`);
  else {
    const c = summary.checked;
    io.stdout.write(`Share-safe check: ${file}\n`);
    io.stdout.write(`Checked: ${c.names} names, ${c.paths} paths, ${c.excerpts} session excerpts, ${c.os_user ? 'the OS user, ' : ''}absolute paths\n`);
    io.stdout.write(control.length ? `Control: the same check finds ${control.length} of these names in your local report, so it can fail\n` : 'Control: none of these names is in your local report, so this check could not show it can fail\n');
    if (found.length) {
      io.stdout.write(`NOT SAFE: found ${found.length}:\n${found.map((x) => `  ${x}`).join('\n')}\nDo not share this file. Please report this, without the file.\n`);
    } else io.stdout.write('OK: nothing this check knows about is in the share-safe copy. Still read it before you send it.\n');
  }
  return { code: found.length ? EXIT.INTEGRITY : EXIT.OK, summary };
}
