# shrine-inspect

T0 setup scan of a Claude Code environment against the SHRINE docs. Local, read-only, no network, zero model calls.

Status: pre-release (SP1). Install and docs cutover arrive in SP3; until then the prompt-based inspect in `docs/` stays live.

## Run

- `node bin/shrine-inspect.mjs run --tier T0 --no-history`
- Without `--no-history`, the run pauses at Gate A (exit 3) until you answer in your own terminal: `node bin/shrine-inspect.mjs approve <run> A <no-history|history>`
- Gate A `history` is recorded as consent; this version still reads setup only
- Output: one run folder under the state dir with `state.json`, `scan.json`, `facts.json`, `findings.json`, `verify.json`, `report.html`, `report.share-safe.html`, `spy.jsonl`, `gate.json` when a gate paused the run, and a `<phase>.done` marker per phase
- `report.share-safe.html` masks names, paths, and hosts and drops session excerpts; it may mask extra words, to keep names out
- `node bin/shrine-inspect.mjs purge` deletes the state and cache dirs, only if this tool created them
- Exit codes: 0 ok, 1 internal, 2 usage, 3 gate waiting, 4 unsupported format (reserved, not raised yet), 5 integrity failure

## Develop

- Node 20 or newer; no runtime dependencies
- `npm test`: unit, fixture, golden, e2e; the whole run fails after 10 minutes (`SHRINE_TEST_TIMEOUT_MS`) instead of hanging
- `npm run lint`: read-only, copy, and no-network lints
- `npm run test:visual`: Playwright snapshots plus axe (run `npx playwright install chromium` once)
- Linux baselines (`*-linux.png`, used by CI) come from the `mcr.microsoft.com/playwright:v1.64.1-noble` image; regenerate them there, not on a laptop OS
- `npm run build:catalogue`: rebuild `src/catalogue/catalogue.json` from `docs/`; add `-- --golden` to refresh `test/golden/catalogue.json`
- `UPDATE_GOLDEN=1 node scripts/test.mjs zero-history`: refresh the zero-history goldens after a reviewed change
- Only `src/io/runfolder.mjs` writes; only `src/io/proc.mjs` spawns (git plus this package's own bin)
