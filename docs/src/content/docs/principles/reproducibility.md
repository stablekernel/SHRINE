---
title: "Reproducibility"
description: "Can you reproduce results? Should you try?"
---

*Same inputs, predictable outputs.*

## The Challenge

LLMs are inherently non-deterministic. Temperature, sampling, and model updates all introduce variance. Pure reproducibility may be impossible or undesirable.

## Levels of Reproducibility

### Exact Reproduction
- Same output every time
- Requires: temperature=0, same model version, same prompt
- Even then, not guaranteed

### Statistical Reproduction
- Similar outputs, same distribution
- More realistic goal
- Measure variance, don't eliminate it

### Behavioral Reproduction
- Same *kind* of output
- Right answer may vary in phrasing
- Test behavior, not bytes

## Why It Matters

- Debugging requires reproducing the bug
- Testing requires predictable baselines
- Auditing requires traceable decisions
- Trust requires consistency

## Strategies

- Pin model versions where possible
- Log full prompts and parameters
- Seed random where supported
- Test behavior ranges, not exact outputs

## When Variance is Good

- Creative tasks benefit from diversity
- Exploration over exploitation
- Avoiding over-fit to specific phrasings

## Anti-patterns

- Assuming reproducibility without testing
- Flaky tests that depend on exact output
- No versioning of prompts/models
- Chasing perfect reproducibility at high cost
