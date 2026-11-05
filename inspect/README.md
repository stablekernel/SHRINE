# shrine-inspect

T0 setup scan of a Claude Code environment against the SHRINE docs. Local, read-only, no network, zero model calls.

Status: pre-release (SP1). Install and docs cutover arrive in SP3; until then the prompt-based inspect in `docs/` stays live.

## Run

- `node bin/shrine-inspect.mjs run --tier T0 --no-history`
- Without `--no-history`, the run pauses at Gate A (exit 3) until you answer in your own terminal: `shrine-inspect approve <run> A <no-history|history>`
- Output: one run folder under the state dir with `facts.json`, `scan.json`, `findings.json`, `verify.json`, `report.html`, `report.share-safe.html`
- `shrine-inspect purge` deletes the state and cache dirs
- Exit codes: 0 ok, 1 internal, 2 usage, 3 gate waiting, 4 unsupported format, 5 integrity failure

## Develop

- Node 20 or newer; no runtime dependencies
- `npm test`: unit, fixture, golden, e2e
- `npm run lint`: read-only, copy, and no-network lints
- `npm run test:visual`: Playwright snapshots plus axe (run `npx playwright install chromium` once)
- `npm run build:catalogue`: rebuild `src/catalogue/catalogue.json` from `docs/`; add `-- --golden` to refresh `test/golden/catalogue.json`
- `UPDATE_GOLDEN=1 node scripts/test.mjs zero-history`: refresh the zero-history goldens after a reviewed change
- Only `src/io/runfolder.mjs` writes; only `src/io/proc.mjs` spawns (git plus this package's own bin)
