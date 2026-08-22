---
title: "Self-Critique"
description: "Have the model evaluate its own output against criteria."
---

*Built-in quality check.*

## The Pattern

After generating output, prompt the same or a follow-up call to critique the output against specific criteria, then revise based on findings.

## When to Use

- Quality-sensitive outputs
- When you can articulate what "good" looks like
- As a lighter alternative to adversarial review
- When external verification is expensive

## Implementation

Two-phase approach:
1. Generate initial output
2. "Review this output for [criteria]. List any issues. Then provide a revised version."

Or single-pass:
- "After your response, critique it for [criteria] and revise if needed."

## Criteria Examples

- Accuracy: "Are all claims verifiable?"
- Completeness: "Is anything missing?"
- Clarity: "Would this confuse the reader?"
- Tone: "Does this match the requested voice?"

## Limitations

- Models have blind spots about their own errors
- Self-critique is weaker than external review
- Can add tokens without adding value on simple tasks

## Related Patterns

- [Adversarial Review](/the-shrine/patterns/adversarial-review/): External skeptic instead of self-review
- [Iterative Refinement](/the-shrine/patterns/iterative-refinement/): Multiple passes with different focuses
