---
title: "Multi-Model Consensus"
description: "Running the same task across multiple models and comparing results."
proposal: "https://github.com/stablekernel/SHRINE/commit/d5f06a07"
last-reviewed: 2026-10-07
status: ratified
---

*If three independent attempts agree, the answer is more trustworthy.*

## The Pattern

Run the same task through multiple models (or the same model with different prompts/temperatures), then:
- Compare outputs for agreement
- Flag divergence for human review or deeper investigation
- Use consensus as a confidence signal

## When to Use

- Factual questions where correctness matters
- Classification or categorization tasks
- Any task where "the model might be wrong" is a real concern
- Calibrating confidence before acting on output

## When Not to Use

- A deterministic check exists; run it instead
- Open-ended writing, where outputs differ by design
- All candidate models share the same blind spot (same training data, same missing context)

## Implementation Notes

- Models should be truly independent (different providers or architectures)
- Same-model different-temperature is weaker but still useful
- Consensus doesn't guarantee correctness, but divergence is a strong signal of uncertainty

## Cost Considerations

This pattern multiplies inference cost by the number of models. Use it when:
- The cost of being wrong exceeds the cost of extra inference
- You need confidence, not just output
- The task is a bottleneck worth investing in

## Worked Example

- **Illustrative case** (hypothetical)
- **Task**: classify 500 support tickets by severity
- **Run**: three models from different providers classify each ticket
- **Result**: 460 agree; 40 diverge
- **Action**: the 40 go to a human; agreed labels are spot-checked on a sample of 20
- **Finding**: most divergence is on tickets that mention data loss; the severity rubric gets a rule for it

## Anti-patterns

- Using consensus to avoid thinking ("they all agreed, must be right")
- Ignoring the dissenting model when two agree and one doesn't
- Running consensus on tasks where models share the same blind spots

## Related Patterns

- [Adversarial Review](/SHRINE/patterns/adversarial-review/): One model challenges another's output
