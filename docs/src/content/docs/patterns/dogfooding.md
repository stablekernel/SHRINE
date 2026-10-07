---
title: "Dogfooding"
description: "Validate by using your own output."
proposal: "https://github.com/stablekernel/SHRINE/commit/95a5e7f7"
last-reviewed: 2026-10-07
status: ratified
---

*If you won't use it, why should anyone else?*

## The Pattern

Before shipping a skill, prompt, workflow, or tool to others, use it yourself on real work. Discover friction firsthand.

## When to Apply

- New skills or prompts before sharing with the team
- Workflows before documenting them as standards
- Tools before recommending to clients
- Patterns before encoding in governance

## When Not to Use

- One-off scripts no one else will run
- You are not a realistic user; find one who is and watch them use it
- Changes a deterministic test fully covers

## What Dogfooding Reveals

- Friction you didn't anticipate
- Edge cases the happy path missed
- Assumptions that don't hold
- Steps that feel obvious to the author but aren't

## Implementation

1. Build the thing
2. Use it on real work (not toy examples)
3. Note every point of friction
4. Fix or document before shipping
5. Repeat until it feels effortless

## The Bar

Not "does it work?" but "would I choose to use this?"

If you find yourself avoiding your own tool, that's signal.

## Worked Example

- **Illustrative case** (hypothetical)
- **Thing**: a "write PR description" skill before sharing it with the team
- **Use**: the author runs it on their next five real PRs
- **Friction found**: it ignores the repo's PR template; it asks for a ticket ID even when there is none
- **Fix**: read the template first; make the ticket ID optional
- **Ship**: shared after two more PRs with no edits needed

## Anti-patterns

- Testing on synthetic examples only
- Shipping before personal validation
- Dogfooding once, then never again (things drift)
- Exempting yourself from your own standards
