---
title: "Problem Before Prescription"
description: "Present the problem and constraints, explore solutions, then commit."
proposal: "https://github.com/stablekernel/SHRINE/discussions/14"
last-reviewed: 2026-10-07
status: ratified
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
- When the human already holds decisive context, that context is a constraint: state it, and why it decides the solution

## In Practice

**Prescriptive prompt**

- "Add a cache in front of the orders endpoint with a 5 minute TTL."
- The model builds exactly that, whether or not caching is the right fix

**Problem prompt**

- **Problem**: the orders endpoint p95 latency is 2.4s; users abandon checkout
- **Constraints**: no new infrastructure this quarter; order status must never be stale after payment
- **Win**: p95 under 500ms on the existing load test, no stale status after payment
- **Ask**: clarifying questions first, then 2-3 options with tradeoffs

**Model questions**

- Where does the time go: database, downstream calls, or serialization?
- Which fields change after payment, and which are static?

**Options returned**

- Add a missing index on the status query: cheap, fixes the hot path if profiling confirms the database
- Batch the three downstream calls in parallel: moderate effort, cuts fan-out latency
- Response cache: rejected; needs new infrastructure and risks stale status

**Chosen spec**

- Chosen: the index, then parallel downstream calls if p95 is still over target
- Problem, constraints, and win as above
- Acceptance: load test p95 under 500ms; a test confirms status updates immediately after payment
- Out of scope: caching, schema redesign

## Techniques

- **Clarify first**: have the model ask questions before it proposes
- **Option generation**: 2-3 approaches with tradeoffs, then choose
- **Spec, then build**: agree on a minimal written spec (problem, constraints, acceptance criteria with checks, out of scope) before implementation. See [Spec, Then Build](/SHRINE/patterns/spec-then-build/)

## Signal of Violation

- Twenty turns of "no, not like that": steering by correction instead of stating constraints up front
- The model builds the requested solution well, and it solves the wrong problem
- Constraints surface only after code exists

## Related

- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): turn the chosen option into checkable criteria
- [Verification Loops](/SHRINE/patterns/verification-loops/): acceptance checks from the spec drive the loop
- [TTV](/SHRINE/principles/tokens-to-value/): exploration costs tokens; spend it where the solution is uncertain
- [Chain of Thought](/SHRINE/patterns/chain-of-thought/): make the reasoning visible
- [Iterative Refinement](/SHRINE/patterns/iterative-refinement/): refine after committing
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): the human picks the option
- [Delegation Fit](/SHRINE/patterns/delegation-fit/): a brief shape for small delegated tasks

Proposal: [Discussion #14](https://github.com/stablekernel/SHRINE/discussions/14)
