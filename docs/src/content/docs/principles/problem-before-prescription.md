---
title: "Problem Before Prescription"
description: "Present the problem and constraints, explore solutions, then commit."
proposal: "https://github.com/stablekernel/SHRINE/discussions/14"
last-reviewed: 2026-09-16
---

*You hold the constraints. The model holds the solution space.*

## The Principle

- When prompting a model, act as the user, not the architect
- State the problem and its constraints before any solution
- Explore candidate solutions before committing to one

## Why

- Humans hold context the model cannot see: constraints, history, stakeholders
- Models hold breadth: approaches the human has not considered
- Prescribing first discards that breadth and anchors on the human's first idea

## Scope

- Applies when the solution space is uncertain
- Exploration costs tokens, in tension with [TTV](/SHRINE/principles/tokens-to-value/)
- When the human already holds decisive context, prescribe, and state why

## Techniques

- **Clarify first**: have the model ask questions before it proposes
- **Option generation**: 2-3 approaches with tradeoffs, then choose
- **Spec, then build**: agree on a written spec before implementation

## Related

- [Chain of Thought](/SHRINE/patterns/chain-of-thought/): make the reasoning visible
- [Iterative Refinement](/SHRINE/patterns/iterative-refinement/): refine after committing
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): the human picks the option

Proposal: [Discussion #14](https://github.com/stablekernel/SHRINE/discussions/14)
