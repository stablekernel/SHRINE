---
title: "Reviewable Output"
description: "Shape delegated code and documents so a human can review them against intent, not from scratch."
proposal: "https://github.com/stablekernel/SHRINE/pull/17"
last-reviewed: 2026-10-07
status: ratified
---

*Review cost is set by the shape of the output, not only by its quality.*

## The Pattern

- Ask for output in a shape that is cheap to review
- Machines check syntax, style, and tests first; the human reviews intent and design
- Large work arrives in stages, each a smaller review than the whole

## When to Use

- Delegation fits, but review of the result is the slow step
- Diffs that touch several concerns at once
- Changes a reviewer must read against a repo convention

## When Not to Use

- One-line or throwaway changes
- Exploration spikes that will be discarded
- Output a deterministic check fully covers, with no design decision in it

## Shape

- **Small diffs**: one concern each ([Delegation Fit](/SHRINE/patterns/delegation-fit/#sizing))
- **Evidence attached**: the command run and its output, not a claim of success ([Verification Loops](/SHRINE/patterns/verification-loops/#acceptance-criteria))
- **Review note**: decisions made, deviations from the brief, places it was unsure
- **Known pattern**: name the existing code it mirrors, so review is a diff against a known shape ([Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/))

## Staged Checkpoints

- Approve the plan, then the interface or schema, then the implementation
- Each stage is a smaller review than the whole
- A rejected plan costs minutes; a rejected implementation costs the run
- Plan stage: [Spec, Then Build](/SHRINE/patterns/spec-then-build/#plan-review-gate)
- Each stage presented as a [Decision Card](/SHRINE/patterns/checkpoint-gates/#decision-card)

## Review Order

1. Deterministic checks: compile, lint, typecheck, tests
2. Machine review against the brief ([Adversarial Review](/SHRINE/patterns/adversarial-review/))
3. Human review of intent and design

## Worked Example

- **Illustrative case** (composite, not a transcript)
- **Change**: move session storage from in-process memory to the shared cache

**Delivered as one diff**

- 31 files: interface change, two backends, config, call-site updates, tests
- No note; the reviewer reads every file to find the design decisions

**Delivered staged**

1. Plan: three bullets and one open question (TTL on logout); approved with one change
2. Interface: one file, the new `SessionStore` contract; approved as is
3. Implementation: the rest, with test output and a review note
   - Decision: sessions written through, read from cache first
   - Deviation: kept the in-process store for tests, not removed as briefed
   - Unsure: eviction behavior under memory pressure
- The reviewer reads the note, checks the one deviation, and spends the time on the eviction question

## Anti-patterns

- One diff that mixes a refactor with a behavior change
- "Tests pass" with no command or output
- Human review spent on formatting that a linter owns
- Reviewing the implementation before anyone approved the plan

## Related

- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): make every checkpoint fast to clear
- [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/): when review finds a miss, fix the input
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): the decision card format
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): plan review before execution
