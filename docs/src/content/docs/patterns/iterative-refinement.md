---
title: "Iterative Refinement"
description: "Improving output through successive passes."
---

*First draft, then polish. Repeat until done.*

## The Pattern

Generate initial output, then run additional passes that:
- Identify specific weaknesses
- Make targeted improvements
- Know when to stop (diminishing returns)

## When to Use

- Creative or complex output that benefits from revision
- Tasks where "good enough" isn't good enough
- When feedback loops are cheap relative to the value of improvement
- Output that will be seen by humans and quality matters

## Implementation Notes

- Each pass should have a specific focus (clarity, accuracy, brevity)
- Define stopping criteria: score threshold, max iterations, or no-change detection
- Later passes should see the evolution, not just the current state
- Track what changed to detect loops or regressions

## Refinement Focuses

- **Clarity**: Is this understandable to the audience?
- **Accuracy**: Are all claims correct and supported?
- **Brevity**: Can this be shorter without losing meaning?
- **Completeness**: Is anything missing?
- **Tone**: Does this match the intended voice?

## Anti-patterns

- Infinite loops (no stopping criteria)
- Passes that undo each other's work
- Refining when the first draft was already good enough
- Over-polishing low-stakes output

## Related Patterns

- [Adversarial Review](/SHRINE/patterns/adversarial-review/): External challenge instead of self-improvement
