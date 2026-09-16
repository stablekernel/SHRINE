---
title: "Reproducibility"
description: "Choose the reproducibility level each part needs, and build the mechanisms to hit it."
proposal: "https://github.com/stablekernel/SHRINE/discussions/9"
last-reviewed: 2026-09-16
---

*Define "similar" per use case. Never assume it.*

## The Principle

- Decide the reproducibility level each part of the system requires
- Build the mechanisms to achieve it: pinning, seeding, logging, evaluation

## Why

- **Debugging**: an unreproducible bug cannot be fixed or proven fixed
- **Testing**: assertions need a stable baseline, or tests flake and get deleted
- **Auditing**: "why did it do that?" requires replaying the inputs
- **Trust**: different answers to the same question erode belief in all of them
- Exact reproducibility everywhere is often unachievable and sometimes undesirable

## Levels

- **Exact**: byte-identical output; pinned model, temperature 0, fixed seed; breaks on provider updates
- **Statistical**: same distribution; assert on aggregates over N runs
- **Behavioral**: same kind of output (right answer, right tool call, valid schema); phrasing varies

## Defaults

- Production: behavioral
- Debugging: exact, by replaying logged inputs and outputs, not regenerating
- Exploration and brainstorming: variance is a feature; mark those paths exempt

## Implemented By

- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): behavioral baselines for prompts
- [Structured Output](/SHRINE/patterns/structured-output/): checkable output shape
- [Observability & Logging](/SHRINE/stack/observability/): log model version, parameters, seed, prompt
- [Evaluation & Benchmarking](/SHRINE/stack/evaluation/): N-run pass thresholds

## Open Questions

- What flake rate is acceptable before a suite loses trust?
- How do we detect a provider model update that shifts our baselines?

Proposal: [Discussion #9](https://github.com/stablekernel/SHRINE/discussions/9)
