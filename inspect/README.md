# shrine-inspect

Health check of a Claude Code environment against the SHRINE docs. T0: setup audit plus usage counts from local session logs; local, read-only, no network, zero model calls. T1 ("Pulse", trial): T0 plus 12 sampled episodes judged by your own harness, only after you approve it at Gate B.

Status: pre-release trial (SP3: background runs, a thin skill, a checksummed release). Nothing is published yet; the docs guide page (`docs/src/content/docs/guide/inspect.mdx`) documents this CLI, and its install steps apply once the owner publishes a release. Testers: see [TRIAL.md](TRIAL.md).

## Install (trial)

- From the release files: `sh install.sh --skill` checks Node 20 or newer and the SHA-256 pinned in `install.sh`, then extracts to `~/.local/share/shrine-inspect/<version>/` and links `~/.local/bin/shrine-inspect`
- A changed tarball exits 4 and installs nothing; `--skill` copies only the skill to `~/.claude/skills/shrine-inspect/`
- The skill (`skill/`) is a thin driver: it checks Node, runs `start` and `status`, and sends you to your own terminal for every gate; it holds no logic
- `shrine-inspect version --skill-version <v>`: any command refuses a skill from another release before it reads anything (exit 2, `E_VERSION`)

## Run

- `node bin/shrine-inspect.mjs run --tier T0 --no-history`: setup and repos only
- Without `--no-history`, the run pauses at Gate A (exit 3) until you answer in your own terminal: `node bin/shrine-inspect.mjs approve <run> A <no-history|history>`
- Gate A lists projects, date range, size on disk, and a size-based time estimate; every run asks again
  - A choice named on the command line is confirmed only by a typed `yes`, at every gate; `y` leaves the run paused
  - Before Gate A: file names, sizes, and dates, plus the first 10 lines of the newest session file per folder, read to find its folder
  - Those lines can hold a prompt; only `cwd`, `entrypoint`, and `version` are kept, and no prompt text is kept or shown
  - The rest of each session is read only after `history`
- `--session-id <id>` leaves out the session driving the run; without it, the newest session file written in the last 5 minutes is left out
- Gate B is fixed at T0 with `--tier T0`; `--tier T1` asks at Gate B after the scan (see T1 below)
  - After the scan it prints one "do you need more than a scan yet" line from sessions, your messages, and days spanned (also in `gate-b.json`, `scan.json`, and `--json` as `gate_b`)
  - Under 10 sessions: "not yet", limited history; under 20 messages or 7 days: "not yet", short history (provisional bars in `thresholds.json`); no history: "unknown"
- With history: usage counts (sessions, human messages, interrupts, compactions, retries, subagent share, correction candidates, done claims without a prior test) in the report appendix and header
  - Counts are human messages, not pattern hits: a message with several correction cues counts once
  - Dropped before counting, shown in the appendix: resent messages (same text right after an interrupted or unanswered send, same session) and session files that repeat lines already read (a fork, a resume, or one session saved in 2 project folders; matched by line uuid; a file with nothing else is left out)
  - One project above 60% of episodes: a line in the usage block, and "Mostly 1 project" on every rate line
  - Pattern-based counts are never findings at T0 (E5 precision: done-claim 33%, test-command 35%, identical-retry 17%)
  - `sdk-cli` sessions are never read in full; each is classified from its first lines after consent
    - Housekeeping (first prompt matches `src/probes/patterns/housekeeping.json`): left out, counted in one appendix line
    - Spawned work (any other `sdk-cli`): linked to the interactive session running in the same repo at that time, shown as byproducts, never judged; no parent found means "unattributed automation"
  - Before consent a folder is excluded as automation when its newest file is `sdk-cli` (entrypoint only, no prompt); after consent every file is re-checked, so mixed folders keep their interactive sessions
  - Rework within 72 hours (headline) counts named reverts only, shown with N
    - Candidate counts, appendix only: "possible rework (later-session fix)" (a fix on the same files from a later session, at least 1 hour after the commit) and "possible rework (file overlap)"
    - Fix commits in the same session or within 1 hour are "iteration commits", never rework
  - Fewer than 10 sessions: counts only plus a "limited history" note
- Output: one run folder under the state dir with `state.json`, `scan.json`, `gate-b.json`, `facts.json`, `findings.json`, `verify.json`, `report.html`, `report.share-safe.html`, `spy.jsonl`, `gate.json` when a gate paused the run, and a `<phase>.done` marker per phase
- `report.share-safe.html` masks names, paths, and hosts and drops session excerpts; it may mask extra words, to keep names out
- `facts.json` holds counts, generic timeline labels, and scrubbed paths; no prompt or reply text
- `node bin/shrine-inspect.mjs purge` deletes the state and cache dirs, only if this tool created them
- Exit codes: 0 ok, 1 internal, 2 usage, 3 gate waiting, 4 unsupported format (history approved but no session log parsed; setup-only report written), 5 integrity failure

## Background runs

- `shrine-inspect start --tier T0|T1 [--session-id <id>]`: creates the run and continues it in a detached worker, so closing the terminal does not stop it; prints the run id, pid, and log
- The worker has no terminal, so it pauses at every gate; it never answers one
- `shrine-inspect status [<run>] [--json]`: `running` (with judging progress), `gate` (with the exact `approve` line to type), `done` (report paths), `died` (no worker, no report), or `stopped`
- `approve <run> <gate> [choice] --background`: you answer in your terminal, then a worker does the rest
- `resume <run>`: restarts a stopped run in a worker at its first missing `.done` marker
  - Unfinished judging needs a fresh typed yes: only `approve <run> B --background` grants it, once, for 5 minutes; `resume` alone refuses (`E_NEEDS_YES`)
  - `resume` also refuses a run waiting at a gate (`E_GATE_WAITING`) or stopped by a history change (`E_RUN_STOPPED`)
- Run folder extras: `worker.pid` (the one process running the run, foreground or background; removed on exit) and `run.log`
  - While that process lives, `status` says running, and `approve`, `resume`, or another worker is refused (`E_RUN_BUSY`)
- `--background` goes only with `approve` (`start` is always in the background)

## T1 "Pulse" (trial)

- `node bin/shrine-inspect.mjs run --tier T1`: Gate A as above (history is required), then the scan, then Gate B
- Gate B is itemized: episodes, projects, dates, a token range on your own account, minutes, abort rules, and what a judge launch can touch
  - T0 is pre-selected; T1 runs only on a typed `yes` in your own terminal (`approve <run> B T1`)
  - Silence, piped stdin, or any other answer leaves the run paused: zero judge processes, zero tokens
  - The consent, with the approved estimate, is recorded in `facts.json`; the judge command is refused until it is there; every run asks again
- Sample: 12 episodes with a correction candidate, seeded (seed in the report footer), recency thirds, at most 4 per project unless one project holds them all, 3x weight for sessions with 2 or more corrections
  - Fewer than 12 eligible: all are judged, labelled thin evidence; under 10 sessions: T1 is not offered
- Evidence pack per episode: your messages (up to 1,200 characters, 12 messages), the opening 400 characters of each reply, tool names without arguments, and the instruction files loaded for that session
  - Every string is scrubbed for secrets, then masked (names, paths, hosts) before a judge or a file sees it; about 900 tokens per pack at most
  - Over the cap: replies cut first, then instruction files (to about 2,000 characters), then later messages
- Gate B estimate: pack size (bytes / 4) plus a per-call overhead and output measured on Claude Code 2.1.318, then 10% retry reserve and 30% margin on the top
  - Session text is data for the judge, never instructions: it sits inside a fence named by a random nonce, and the judge prompt says so
- Judge: one headless `claude --print` call per episode, one at a time, on your own install and login
  - No session saved, no tools, no MCP servers, your user, project, and local settings files ignored (so no user hooks or plugins), no CLAUDE.md, no auto-memory, non-essential traffic off; output forced to a strict JSON schema
  - Managed (org) settings still apply; Claude Code may update its own state and cache files (`~/.claude.json`, files under `~/.claude/`) on each launch
  - Every judge prompt starts with `SHRINE inspect judge v1:`; any saved judge session counts as housekeeping in later runs and is never judged
  - Invalid output gets one retry with the validator's error; quotes must be exact copies from the episode; no judge free text reaches the report
- Stops early (Gate C, keep partial or stop) past the approved token upper bound, past the time box plus 50%, at over 10% invalid answers, or on a usage limit
  - Judging stopped part way resumes only on a fresh typed yes (`approve <run> B`); a resume already past the token bound makes no call
  - One runner per run: a second `approve` while judging runs is refused (`E_JUDGE_BUSY`); a marker left by a dead process is ignored
  - Gate C answered but no report (a crash): `approve <run> B` or `C` writes the report, with no prompt and no judge call
- Findings (2 kinds): `late_constraint` (a constraint arrived in your 2nd or 3rd message, in neither the first message nor loaded instructions) and `ignored_instruction` (a correction restated a loaded instruction, matched by an exact quote)
  - Each needs 3 judged episodes (or 20% of those judged, at least 2) and a code-flagged correction in each
  - Judged findings stay candidates until the judge's accuracy is measured against labelled episodes: each carries a plain caveat, never reaches high confidence, and is never "Start with"
  - Each shows N judged episodes, sessions, and repos; a timeline; and a before and after from your own prompt when the correction is one short clause
- Extra files in the run folder: `sample.json` (ids and counts only), `workorder.json` (the packs, written after the yes), `judgments.jsonl` (validated output only)

## Known limits

Recorded, not fixed; a test pins each one, so a change is deliberate.

Masking (`test/scrub/known-limits.test.mjs`):

- Share-safe may over-mask words near a path or document name: `Read ~/work/api Then Stop` gives `Read ~/<path>/<file>`
- In free text, a path followed by a parenthesis can swallow the next word: `~/work/api (git timed out)` gives `~/<path>/<file> timed out)`
- A lowercase name part of 4 characters or fewer after a dot is kept as an extension: `acme.corp` gives `<file>.corp`

Counting (`test/adapters/claude-code/dedupe.test.mjs`):

- The same prompt pasted into a new, unforked session counts again; only resends inside one session are dropped
- Files are read by first-line time, then creation time, then last change; where the filesystem keeps no reliable creation time (none, or the last metadata change) and the original was written after its fork, the original loses the shared lines instead (each line still counts once, but a later correction there can read as an episode's first message)
- A fork of a session older than the retention window keeps the copied lines as its own: the source file is not read, so nothing marks them as copies
- The same holds for a fork of the session running the scan, which is never read
- A message with an image is never dropped as a resend, even when the picture is the same
- Lines with no uuid (older session formats) are never matched as copies

Background runs (`test/cli/background.test.mjs`):

- A run is "running" while the pid in `worker.pid` is alive; a process stopped by Ctrl-C or killed (or a worker that exits before its parent records it) leaves the file, and if the OS reuses that pid, `status` says running and `approve` or `resume` says busy until that process ends; deleting `worker.pid` in the run folder clears it
- `worker.pid` is checked, then written, not claimed in one step: two `run`, `approve`, or `resume` calls on one run at the same instant can both continue it (judging stays single, below)
- `purge` does not wait for a running run: it deletes the folder under the worker, which then stops; a judge call already sent still completes
- `spy.jsonl` is saved before the runner removes `worker.pid`, so that one removal (inside the run folder) is not in it
- Two `approve --background` calls on one run at the same instant can both start a worker (the busy check and the pid write are not one step)
  - Judging still has one runner: `judging.pid` is claimed by exclusive create, and a live runner's marker is never removed; only two runners finding the same dead marker at the same instant could both claim it
- The installed link runs whatever `node` is first on PATH later; the installer checks Node 20 only at install time
- The installer hashes the tarball, then extracts from the same path; a local process that swaps the file in between is not caught
- `install --skill` replaces the whole `~/.claude/skills/shrine-inspect/` folder when it holds this skill from another release
- The one-time judging grant sits in `state.json` and the worker's arguments from `approve --background` until the worker reads it; a worker that dies first leaves it there until it expires (5 minutes)
- `run.log` holds the worker's own messages only; gate prompts appear in the terminal that answers them

T1 trial (recorded, not fixed):

- Judge isolation was checked once, on one setup with 2.1.318 (only the structured-output tool, no MCP servers, no user plugins, no hooks fired, user model setting ignored); no probe checks it on your setup
- At 12 episodes the top of the Gate B range passes 60K tokens at any pack size: the fixed cost per call (prompt, overhead, output; about 4K) times 12, plus reserve and margin (`test/judge/workorder.test.mjs`)
- A correction you later reversed still gives a before and after from your own words
- The harness version shown at Gate B comes from your newest session log, not from the installed command
- A session whose loaded-instructions snapshot is logged only after an episode starts is read as "may have changed", so its corrections stay "could not tell"

## Develop

- Node 20 or newer; no runtime dependencies
- `npm test`: unit, fixture, golden, e2e (planted-failure suite with synthetic histories); the whole run fails after 10 minutes (`SHRINE_TEST_TIMEOUT_MS`) instead of hanging
- `npm run lint`: read-only, copy, and no-network lints
- `npm run test:visual`: Playwright snapshots plus axe (run `npx playwright install chromium` once)
- Linux baselines (`*-linux.png`, used by CI) come from the `mcr.microsoft.com/playwright:v1.64.1-noble` image; regenerate them there, not on a laptop OS
- `npm run build:catalogue`: rebuild `src/catalogue/catalogue.json` from `docs/`; add `-- --golden` to refresh `test/golden/catalogue.json`
- `UPDATE_GOLDEN=1 node scripts/test.mjs zero-history golden.test`: refresh the zero-history and per-version facts goldens after a reviewed change
- Pattern lists live in `src/probes/patterns/*.json`, each with positive and negative fixtures; thresholds and ship modes in `src/scorer/thresholds.json`
- Only `src/io/runfolder.mjs` writes; only `src/io/proc.mjs` spawns (git, this package's own bin, and the adapter's judge command after a Gate B yes)
- Tests never call a model: `test/fixtures/judge/fake-judge.mjs` stands in for the harness CLI (valid, invalid, refusal, injection-follow, usage limit)
- `UPDATE_GOLDEN=1 node scripts/test.mjs scorer/judged`: refresh `test/golden/t1-pulse/` after a reviewed change
- `node scripts/release.mjs [--out <dir>]`: offline, deterministic build of `shrine-inspect-<version>.tgz`, a pinned `install.sh`, and `SHA256SUMS` (default `dist/`)
  - Ships the package.json `files` list, a package.json without scripts or devDependencies, and the repo root `LICENSE` and `NOTICE`
- `node scripts/dry-run.mjs [--dir <work>] [--require-node20]`: builds, installs into a clean HOME with a synthetic history, runs a background T1 with a stand-in judge (no model call), then the read-only hash check and share-safe leak check; prints and keeps a transcript
  - Node 20 from this Node, nvm, fnm, or volta; otherwise it reports the gap
- Releases: a pushed `inspect-v<version>` tag builds a draft GitHub release; the owner publishes it
- License: Apache-2.0 (repo root `LICENSE` and `NOTICE`). Ideas (counting messages, dropping resends and forks, a repo-concentration warning) came from justin-carper/reflect (MIT); no code or prompt text was copied
