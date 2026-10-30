# AGENTS.md

## Generated skill

- Everything under `skills/agentic-power-user/` (the `SKILL.md` router and `references/`) is generated from the principle and pattern pages; never edit it by hand
- Whenever docs change, run `npm --prefix docs run gen:skill` and commit every regenerated file, added or removed, in the same PR
- `npm --prefix docs run check:skill` must pass before you push; CI runs it on every PR
