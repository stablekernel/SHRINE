# SHRINE Docs Site

Source for the published site at https://stablekernel.github.io/SHRINE/.

## Run Locally

Requires Node 22 (matches CI).

```sh
cd docs
npm ci
npm run dev      # http://localhost:4321/SHRINE/
npm run build    # output in docs/dist/
npm test         # checker tests (Node built-in runner); CI runs them before the build
```

## Layout

- Pages: `src/content/docs/` (`principles/`, `patterns/`, `stack/`, `reference/`)
- Sidebar: `astro.config.mjs`; add principle, pattern, and stack pages there (`reference/` autogenerates)
- Internal links: absolute with the base, such as `/SHRINE/patterns/overview/`
- Inspect prompt: `src/prompts/shrine-inspect.md`; its read-only checker: `src/tools/shrine-check.mjs` (tests in `tests/`)

## Contributing

- New principles, patterns, or stack changes start as a Discussion; see [Governance](https://stablekernel.github.io/SHRINE/reference/governance/)
- Content changes land by pull request
- Write terse bullets; no em dashes
- Stack slot definitions and selection criteria stay product-agnostic ([FAQ](https://stablekernel.github.io/SHRINE/faq/))
- `npm run build` must pass before you open a PR
