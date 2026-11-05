# shrine-inspect

T0 scan of a Claude Code environment against the SHRINE docs: setup audit plus usage counts from local session logs. Local, read-only, no network, zero model calls.

Status: pre-release (SP2). Install and docs cutover arrive in SP3; until then the prompt-based inspect in `docs/` stays live.

## Run

- `node bin/shrine-inspect.mjs run --tier T0 --no-history`: setup and repos only
- Without `--no-history`, the run pauses at Gate A (exit 3) until you answer in your own terminal: `node bin/shrine-inspect.mjs approve <run> A <no-history|history>`
- Gate A lists projects, date range, size on disk, and a size-based time estimate; history is read only after `history`, and every run asks again
- `--session-id <id>` leaves out the session driving the run; without it, the newest session file written in the last 5 minutes is left out
- Gate B is fixed at T0 (`--tier T0`); deeper tiers are not available yet
- With history: usage counts (sessions, turns, interrupts, compactions, retries, subagent share, correction candidates, done claims without a prior test) in the report appendix and header
  - Pattern-based counts are never findings at T0 (E5 precision: done-claim 33%, test-command 35%, identical-retry 17%)
  - `sdk-cli` sessions are never read in full; each is classified from its first lines after consent
    - Housekeeping (first prompt matches `src/probes/patterns/housekeeping.json`): left out, counted in one appendix line
    - Spawned work (any other `sdk-cli`): linked to the interactive session running in the same repo at that time, shown as byproducts, never judged; no parent found means "unattributed automation"
  - Before consent a folder is excluded only when its newest file is housekeeping; after consent every file is re-checked, so mixed folders keep their interactive sessions
  - Rework within 72 hours counts only reverts and fixes (a revert or fixup naming the episode's commit, or a later `fix`/`revert` commit on a file it changed); a later episode touching the same file is a separate "possible rework (file overlap)" candidate count, never a headline number
  - Fewer than 10 sessions: counts only plus a "limited history" note
- Output: one run folder under the state dir with `state.json`, `scan.json`, `facts.json`, `findings.json`, `verify.json`, `report.html`, `report.share-safe.html`, `spy.jsonl`, `gate.json` when a gate paused the run, and a `<phase>.done` marker per phase
- `report.share-safe.html` masks names, paths, and hosts and drops session excerpts; it may mask extra words, to keep names out
- `facts.json` holds counts, generic timeline labels, and scrubbed paths; no prompt or reply text
- `node bin/shrine-inspect.mjs purge` deletes the state and cache dirs, only if this tool created them
- Exit codes: 0 ok, 1 internal, 2 usage, 3 gate waiting, 4 unsupported format (history approved but no session log parsed; setup-only report written), 5 integrity failure

## Known limits

Recorded, not fixed; `test/scrub/known-limits.test.mjs` pins each one, so a change is deliberate.

- Share-safe may over-mask words near a path or document name: `Read ~/work/api Then Stop` gives `Read ~/<path>/<file>`
- In free text, a path followed by a parenthesis can swallow the next word: `~/work/api (git timed out)` gives `~/<path>/<file> timed out)`
- A lowercase name part of 4 characters or fewer after a dot is kept as an extension: `acme.corp` gives `<file>.corp`

## Develop

- Node 20 or newer; no runtime dependencies
- `npm test`: unit, fixture, golden, e2e (planted-failure suite with synthetic histories); the whole run fails after 10 minutes (`SHRINE_TEST_TIMEOUT_MS`) instead of hanging
- `npm run lint`: read-only, copy, and no-network lints
- `npm run test:visual`: Playwright snapshots plus axe (run `npx playwright install chromium` once)
- Linux baselines (`*-linux.png`, used by CI) come from the `mcr.microsoft.com/playwright:v1.64.1-noble` image; regenerate them there, not on a laptop OS
- `npm run build:catalogue`: rebuild `src/catalogue/catalogue.json` from `docs/`; add `-- --golden` to refresh `test/golden/catalogue.json`
- `UPDATE_GOLDEN=1 node scripts/test.mjs zero-history golden.test`: refresh the zero-history and per-version facts goldens after a reviewed change
- Pattern lists live in `src/probes/patterns/*.json`, each with positive and negative fixtures; thresholds and ship modes in `src/scorer/thresholds.json`
- Only `src/io/runfolder.mjs` writes; only `src/io/proc.mjs` spawns (git plus this package's own bin)
