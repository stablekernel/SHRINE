---
title: "Adversarial Review"
description: "Using a second model or agent to challenge and verify output."
---

*A reviewer whose job is to find holes, not to approve.*

## The Pattern

After generating output, pass it to a separate agent with explicit instructions to:
- Find flaws, gaps, or unstated assumptions
- Challenge claims that lack evidence
- Identify edge cases the original missed

The adversarial reviewer is not trying to be helpful to the original output. It's trying to break it.

## When to Use

- High-stakes decisions where being wrong is expensive
- Output that will be trusted without human review
- Claims that sound plausible but haven't been verified
- Any "are we sure?" moment

## Implementation Notes

- The reviewer should NOT see the original prompt or reasoning, only the output
- Explicitly instruct it to default to skepticism
- A finding that survives adversarial review is stronger than one that was never challenged

## Anti-patterns

- Using the same model instance for both generation and review (context bleeds)
- Instructing the reviewer to "check if this looks good" (too soft)
- Ignoring findings because they're inconvenient

## Related Patterns

- [Multi-Model Consensus](/the-shrine/patterns/multi-model-consensus/): Multiple independent attempts, then compare
- [Iterative Refinement](/the-shrine/patterns/iterative-refinement/): Improve based on feedback loops
