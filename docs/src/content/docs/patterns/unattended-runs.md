---
title: "Unattended Runs"
description: "Launch an agent to work for hours without a human watching each step."
---

*Decide when it stops before it starts.*

## The Pattern

- Design up front, then a long stretch with no one watching
- Human attention moves to written checkpoints and the end of the run
- The run ends on a stop condition decided before launch, not on someone noticing

## Launch Checklist

- **Spec**: problem, constraints, acceptance criteria ([Spec, Then Build](/SHRINE/patterns/spec-then-build/))
- **Plan**: milestones and progress on a work board or plan file the agent updates
- **Routing config**: which model handles which work ([Task Routing](/SHRINE/patterns/task-routing/))
- **Time limit**: a wall-clock cap on the run, enforced outside the agent ([Cost Management](/SHRINE/stack/cost-management/))
- **Abort criteria**: written, specific, countable
- **Stop condition**: a time limit, or all acceptance criteria pass
- **Gates**: irreversible actions blocked ([Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/))

## Abort Criteria

- Same check fails N times after distinct fix attempts
- The model refuses a step
- The fix needs an edit outside the agreed scope
- On abort, report: what failed, what was tried, the suggested next step
- Never blind-retry bad output ([Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/))
- Prior art: Anthropic notes agents commonly include [stopping conditions such as a maximum number of iterations](https://www.anthropic.com/engineering/building-effective-agents)

## During the Run

- No babysitting
- Read [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/) at agreed times only
- Checkpoints arrive as parked decisions, not live interruptions
- Context resets hand off through the plan file ([Context Handoff](/SHRINE/patterns/context-handoff/))

## When to Use

- Checkable acceptance criteria exist
- Verification is automated ([Verification Loops](/SHRINE/patterns/verification-loops/))
- Irreversible actions are gated

## When Not to Use

- Exploratory work with no checkable win
- No automated verification: the human becomes the loop
- Irreversible actions with no gate
- Task shorter than the setup

## Worked Example

**Setup**

- One ticket, 5-hour time limit

**Run**

- Hour 0: spec and plan reviewed; abort rule "same integration test fails 3 times after distinct fixes"
- Hours 0-3: milestones 1-3 pass; breadcrumbs updated after each
- Hour 3: `test_refund_idempotent` fails a third time; abort fires

**Abort report**

- **Failed**: `test_refund_idempotent`, duplicate refund on retry
- **Tried**: request-ID dedupe in handler; DB unique constraint; transaction retry wrapper
- **Finding**: payment client retries internally before the handler sees the request
- **Next step**: human decides whether the client's retry setting is in scope

**Attention compared (illustrative)**

- Unattended: 20 minutes of spec review, 10 minutes reading the report
- Chat-steered session on the same ticket: a check-in every few minutes for 3 hours
- The report turns the next move into one decision

## Measuring

- **Longest unattended stretch**: time between required human touches
- **Human touches per run**: checkpoints, aborts, corrections
- **Tokens and attention per win**: see [Tokens to Value](/SHRINE/principles/tokens-to-value/)
- Context: METR measures a [50% task-completion time horizon](https://arxiv.org/abs/2503.14499) that has doubled roughly every seven months since 2019; a longer horizon does not remove the need for stop rules

## Anti-patterns

- No stop condition
- Uncapped retries
- Checking in every ten minutes
- Treating the timebox as a delivery deadline: the run stops at the cap, finished or not

## Related

- [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/): abort and report, never loop silently
- [Tokens to Value](/SHRINE/principles/tokens-to-value/): attention per win
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): the spec a run needs
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): gating irreversible actions
- [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/): what the human reads
- [Context Handoff](/SHRINE/patterns/context-handoff/): surviving context resets
- [Cost Management](/SHRINE/stack/cost-management/): tracking cost per win
