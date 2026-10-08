---
title: "Deliberate Currency"
description: "Stay current by owner, cadence, and pre-agreed tripwires, not by drift."
proposal: "https://github.com/stablekernel/SHRINE/discussions/3"
last-reviewed: 2026-10-07
status: ratified
---

*Look again when a tripwire fires. Don't look when none has.*

## The Principle

- Currency with AI tooling is an engineering practice, not spare-time reading
- It has a named owner and a review cadence
- Re-evaluation is triggered by tripwires agreed in advance

## Why

- AI tooling decisions have a half-life of months
- Nothing announces obsolescence; falling behind looks like normal
- Scaffolding decays invisibly and may now make results worse
- Churn is the mirror failure: re-litigating every release resets compounding investment
- Tripwires fix both: we look when something meaningful changes, and only then

## Owner and Cadence

- **Inventory**: every prompt, skill, and workaround, tagged with the model it was tuned against
- **Owner**: a named person accountable for flagging invalidated skills
- **Sweep**: on each major model release, ask whether each item still earns its keep
- **Kill test**: does the skill still beat a plain prompt? Deletion is a win

## Tripwires

- External:
  - Frontier model release in a class we use daily
  - Pricing change beyond an agreed percentage
  - A pattern or protocol reaching real adoption among peers
- Internal:
  - Agent retry rate climbing
  - Humans redoing agent output more often
  - Token spend per shipped change trending up
- Each tripwire has two levels: "log it" and "re-evaluate now"
- Time-box each re-evaluation so thresholds reflect its cost

## Signal of Violation

- Drift: skills tuned against a retired model still load, and nobody can say who owns them
- Churn: tooling choices reopen on every release though no tripwire fired
- Tripwires with no baseline: nobody can state retry rate or spend per shipped change, so nothing ever fires
- An inventory that only grows: no sweep has deleted a skill

## Implemented By

- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): feed findings back
- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): prove a change is safe
- [Evaluation & Benchmarking](/SHRINE/stack/evaluation/): baselines that tripwires compare against

## Open Questions

- Can we state today's cost per shipped change and first-pass success rate?
- Owner by volunteer or rotation?

Proposals: [Discussion #3](https://github.com/stablekernel/SHRINE/discussions/3), [Discussion #4](https://github.com/stablekernel/SHRINE/discussions/4)
