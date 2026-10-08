---
title: "North Star: TTV (Tokens to Value)"
description: "Maximize value per win, where a win costs tokens plus human attention."
proposal: "https://github.com/stablekernel/SHRINE/discussions/2"
last-reviewed: 2026-10-07
status: ratified
---

*Value per win, not tokens per month.*

## The North Star

- TTV is the value delivered per successful, useful outcome (a win)
- The cost of a win is tokens plus human attention
- The goal is driving cost per win down without giving up value
- It sits above the principles; every principle serves it
- Get TTV right and cost takes care of itself

## Why

- Optimizing raw token spend optimizes the exhaust pipe
- Human attention is part of the cost: engineer minutes spent steering, reviewing, babysitting
- Our working judgment is that attention is often the larger of the two; measure it rather than assume it
- Cheap-per-call systems bleed engineer hours in retries, babysitting, and rework
- Illustration, not a finding: a run that costs more tokens but succeeds first time can beat a cheaper run that fails twice and needs a human to restart it
- More tokens that sharply cut an engineer's active involvement lower the cost of a win
- The freed engineer time goes to other work
- A shared denominator settles arguments: does this lower the cost of a win?

## Four Levers

- **Routing**: the right model for each task or step ([Task Routing](/SHRINE/patterns/task-routing/), [Step-Level Routing](/SHRINE/patterns/step-level-routing/))
- **Model iteration**: each generation rewrites the cost curve ([Model Selection](/SHRINE/stack/models/))
- **Skills, prompts, memory**: pay for discovery once ([Skills & Prompts](/SHRINE/stack/skills/), [Memory & Context](/SHRINE/stack/memory/))
- **Agent architecture**: failed runs are the most expensive tokens ([Agent Architecture](/SHRINE/stack/agent-architecture/))

## Measuring It

- Define the "win" per workload class (merged PR, resolved ticket, passing eval run)
- No universal win definition exists; each workload class owns its own
- Tag token usage with an outcome ID
- Track human attention per win too: human minutes or interventions per outcome
- Baseline two or three workflows before rolling out broadly
- Track failed-run tokens in a waste bucket to drive down
- See [Cost Management](/SHRINE/stack/cost-management/) and [Evaluation](/SHRINE/stack/evaluation/)

## Worked Example

Hypothetical numbers, to show the arithmetic only.

- **Workflow**: dependency-bump PRs; win = PR merged without rework
- **Before**: 10 runs, 6 wins
  - Tokens: 1.2M total, of which 0.5M in failed runs (waste bucket)
  - Tokens per win: 200K
  - Human time: 90 minutes steering and restarting
  - Human minutes per win: 15
- **Change**: add a [Verification Loop](/SHRINE/patterns/verification-loops/) that runs the test suite before opening the PR
- **After**: 10 runs, 9 wins
  - Tokens: 1.5M total, of which 0.2M in failed runs
  - Tokens per win: about 167K
  - Human time: 27 minutes, mostly review
  - Human minutes per win: 3
- **Read**: total tokens rose, yet both halves of cost per win fell. That is a TTV improvement

## Signal of Violation

- Optimizing raw token spend: the bill falls while rework or human steering rises
- Attention left out of the cost: cheap runs that an engineer babysits count as savings
- Tokens with no outcome ID: nobody can state what a win costs
- No win defined for the workload: cost arguments settle by opinion

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
