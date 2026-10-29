---
title: "Beta Loop"
description: "Generate, check, repair."
status: ratified
---

## The Pattern

Run passes that:

- Find weaknesses
  - nested detail stays with its parent
- Fix them

## When to Apply

- Output is checkable

## When Not to Use

- No check exists; use [Alpha Rule](/SHRINE/principles/alpha-rule/)

## Anti-pattern: Lone Example

- Not the anti-patterns section

## Anti-patterns

| Symptom | Fix |
| --- | --- |
| Loop edits the test | Freeze the test |
| Truncated errors | Send the full failure |

## Related
