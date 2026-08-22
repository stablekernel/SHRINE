---
title: "Consistency as Leverage"
description: "Pattern predictability reduces tokens more than prompt optimization."
---

*The biggest efficiency lever isn't the prompt. It's the codebase.*

## The Thesis

When code follows predictable patterns, agents require:
- Less context to understand what's happening
- Fewer correction loops to get it right
- Smaller context windows to hold relevant information
- Less hand-holding through unfamiliar territory

Consistency compounds. Prompt optimization is linear.

## Why Consistency Wins

### For Agents
- Predictable patterns mean shorter prompts
- Prior examples in the same codebase transfer
- Less "explain this architecture" overhead
- Fewer "that's not how we do it here" corrections

### For Humans
- Faster onboarding (patterns are documented, not discovered)
- Staffing flexibility (anyone can work on any repo)
- Reduced tribal knowledge silos
- Clearer code review (deviations are visible)

## What Consistency Looks Like

- Standard project structures
- Predictable naming conventions
- Documented architectural patterns
- Consistent error handling
- Uniform testing approaches

## The Investment

Establishing consistency requires upfront work:
- Pattern documentation
- Brownfield onboarding (mapping existing divergences)
- Enforcement through review and tooling
- Periodic reconciliation

The payoff: every future task in that codebase costs less.

## Anti-patterns

- Treating structure as personal preference
- Consistency theater (documented but not followed)
- Over-standardization (constraining where flexibility helps)
- No mechanism to evolve standards
