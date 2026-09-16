---
title: "North Star: TTV (Tokens to Value)"
description: "Maximize what every token buys, measured per successful outcome."
proposal: "https://github.com/stablekernel/SHRINE/discussions/2"
last-reviewed: 2026-09-16
---

*Tokens per win, not tokens per month.*

## The North Star

- TTV is the model consumption it takes to produce one successful, useful outcome
- It sits above the principles; every principle serves it
- Get TTV right and cost takes care of itself

## Why

- Optimizing raw token spend optimizes the exhaust pipe
- Cheap-per-call systems bleed engineer hours in retries, babysitting, and rework
- 20% more tokens with first-attempt success beats cheaper calls that fail twice
- A shared denominator settles arguments: does this lower the cost of a win?

## Four Levers

- **Routing**: the right model for each task or step ([Task Routing](/SHRINE/patterns/task-routing/), [Step-Level Routing](/SHRINE/patterns/step-level-routing/))
- **Model iteration**: each generation rewrites the cost curve ([Model Selection](/SHRINE/stack/models/))
- **Skills, prompts, memory**: pay for discovery once ([Skills & Prompts](/SHRINE/stack/skills/), [Memory & Context](/SHRINE/stack/memory/))
- **Agent architecture**: failed runs are the most expensive tokens ([Agent Architecture](/SHRINE/stack/agent-architecture/))

## Measuring It

- Define the "win" per workload class (merged PR, resolved ticket, passing eval run)
- Tag token usage with an outcome ID
- Baseline two or three workflows before rolling out broadly
- Track failed-run tokens in a waste bucket to drive down
- See [Cost Management](/SHRINE/stack/cost-management/) and [Evaluation](/SHRINE/stack/evaluation/)

## Open Questions

- Who owns the "win" definition for each workload class?
- What is the minimum viable TTV report, and who reviews it?

## Principles That Serve It

- [Authority Cascade](/SHRINE/principles/authority-cascade/)
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/)
- [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/)
- [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/)
- [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/)
- [Reproducibility](/SHRINE/principles/reproducibility/)
- [Deliberate Currency](/SHRINE/principles/deliberate-currency/)

Proposal: [Discussion #2](https://github.com/stablekernel/SHRINE/discussions/2)
