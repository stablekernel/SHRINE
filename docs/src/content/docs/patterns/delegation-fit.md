---
title: "Delegation Fit"
description: "Decide per task whether to delegate, pair, or write by hand, and brief delegated work in one message."
last-reviewed: 2026-10-07
---

*Some tasks cost more to review than to write.*

## The Pattern

- Before prompting, decide per task: delegate, pair, or write by hand
- Keep decisions that belong to a human with the human; decide first, then delegate the rest
- Brief delegated work in one message with explicit non-goals

## When to Use

- Everyday interactive work, before the first prompt
- A feature with parts of different difficulty
- Output from past tasks of this kind needed heavy correction

## When Not to Use

- Multi-hour or unattended runs; use [Spec, Then Build](/SHRINE/patterns/spec-then-build/)
- Pure exploration, where the model's interpretation is the point

## Fit Signals

**For delegating**

- The outcome is checkable by a command
- The repo has an exemplar to mirror
- Boilerplate, broad search, or mechanical change
- Reversible

**Against delegating**

- You already hold the full solution and typing is the only cost
- No check exists, so you become the check ([Verification Loops](/SHRINE/patterns/verification-loops/#why-a-runnable-check))
- Tacit design judgment that is hard to write down
- Review would take longer than writing

These signals are judgment calls and shift as models change. Reassess them on the [Deliberate Currency](/SHRINE/principles/deliberate-currency/) cadence.

## Keep With the Human

- Architecture choices
- Ambiguous requirements
- Anything [Human in the Loop](/SHRINE/principles/human-in-the-loop/#when-to-require-a-human) lists under low confidence
- Decide these first; then delegate the work they unblock

## Middle Mode: Pair

- The model explores, drafts tests, or lists edge cases
- The human writes the core logic
- Useful when the core needs tacit judgment but the edges are mechanical

## Sizing

- One concern per request
- One reviewable diff per request ([Reviewable Output](/SHRINE/patterns/reviewable-output/))
- The brief fits in one message, with no mid-flight clarification ([Agent Architecture](/SHRINE/stack/agent-architecture/#task-boundaries))

## Brief Shape

Extends the problem prompt in [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/#in-practice) for small delegated tasks.

- **Goal**: the problem, not the fix
- **Constraints**: what must not change
- **Non-goals**: what not to touch or start (the spec's "Out of scope")
- **Mirror**: an existing file or function to follow
- **Done**: the command that proves it
- **Ask**: state assumptions or ask questions before editing

Prior art: Claude Code [best practices](https://code.claude.com/docs/en/best-practices) recommend pointing the model at an existing pattern in the codebase to follow.

## Worked Example

- **Illustrative case** (composite, not a transcript)
- **Feature**: add CSV export to the orders report

**Split**

| Part | Mode | Why |
|---|---|---|
| Export format and column contract with the finance team | By hand | Ambiguous requirement; a human decision |
| Streaming large result sets without loading all rows | Pair | Model drafts edge-case tests; human writes the streaming core |
| Handler, route, and auth wiring | Delegate | `GET /reports/{id}/pdf` is an exemplar; tests check it |

**Vague prompt**

- "Add CSV export to the orders report"
- Outcome: one large diff; invented columns, a new CSV library, no streaming; five correction turns

**Brief**

- **Goal**: finance needs the orders report as CSV
- **Constraints**: existing report API unchanged; columns exactly as in `docs/orders-export.md`
- **Non-goals**: no streaming changes; no new dependencies
- **Mirror**: follow `GET /reports/{id}/pdf` for route, auth, and tests
- **Done**: `make test` passes, including new `test_orders_csv_columns`
- **Ask**: list assumptions before editing
- Outcome: one question about date format, answered; one correction, a header casing

## Anti-patterns

- Delegating the architecture decision, then correcting the architecture in review
- Delegating work you could type faster than you could brief
- A brief with no non-goals, so the diff grows past the task
- Fit decided once and never revisited as models change

## Related

- [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/): task fit is the first link in the cause chain
- [Task Routing](/SHRINE/patterns/task-routing/): once delegated, which tier does the work
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): the full spec for long runs
- [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/): the brief starts from the problem
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): human decisions during a run, not before it
- [TTV](/SHRINE/principles/tokens-to-value/): human review minutes count in the cost of a win
