# shrine-inspect

Health check of a Claude Code environment against the SHRINE docs. T0: setup audit plus usage counts from local session logs; local, read-only, no network, zero model calls. T1 ("Pulse", trial): T0 plus 12 sampled episodes judged by your own harness, only after you approve it at Gate B.

Status: pre-release (SP2 plus the T1 trial slice). Install and docs cutover arrive in SP3; until then the prompt-based inspect in `docs/` stays live.

## Run

- `node bin/shrine-inspect.mjs run --tier T0 --no-history`: setup and repos only
- Without `--no-history`, the run pauses at Gate A (exit 3) until you answer in your own terminal: `node bin/shrine-inspect.mjs approve <run> A <no-history|history>`
- Gate A lists projects, date range, size on disk, and a size-based time estimate; every run asks again
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

## T1 "Pulse" (trial)

- `node bin/shrine-inspect.mjs run --tier T1`: Gate A as above (history is required), then the scan, then Gate B
- Gate B is itemized: episodes, projects, dates, a token range on your own account, minutes, abort rules, and what a judge launch can touch
  - T0 is pre-selected; T1 runs only on a typed `yes` in your own terminal (`approve <run> B T1`)
  - Silence, piped stdin, or any other answer leaves the run paused: zero judge processes, zero tokens
  - The consent, with the approved estimate, is recorded in `facts.json`; the judge command is refused until it is there; every run asks again
- Sample: 12 episodes with a correction candidate, seeded (seed in the report footer), recency thirds, at most 4 per project unless one project holds them all, 3x weight for sessions with 2 or more corrections
  - Fewer than 12 eligible: all are judged, labelled thin evidence; under 10 sessions: T1 is not offered
- Evidence pack per episode: your messages (up to 1,200 characters, 12 messages), the opening 400 characters of each reply, tool names without arguments, and the instruction files loaded for that session
  - Every string is scrubbed for secrets, then masked (names, paths, hosts) before a judge or a file sees it; about 6K tokens per pack at most
  - Session text is data for the judge, never instructions: it sits inside a fence named by a random nonce, and the judge prompt says so
- Judge: one headless `claude --print` call per episode, one at a time, on your own install and login
  - No session saved, no tools, no MCP servers, your user, project, and local settings files ignored (so no user hooks or plugins), no CLAUDE.md, no auto-memory, non-essential traffic off; output forced to a strict JSON schema
  - Managed (org) settings still apply; Claude Code may update its own `~/.claude.json` on each launch
  - Every judge prompt starts with `SHRINE inspect judge v1:`; any saved judge session counts as housekeeping in later runs and is never judged
  - Invalid output gets one retry with the validator's error; quotes must be exact copies from the episode; no judge free text reaches the report
- Stops early (Gate C, keep partial or stop) past the approved token upper bound, past the time box plus 50%, at over 10% invalid answers, or on a usage limit
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
