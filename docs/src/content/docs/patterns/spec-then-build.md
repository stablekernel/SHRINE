---
title: "Spec, Then Build"
description: "Agree a written spec and reviewed plan before an agent executes."
---

*Every open question in the spec is a future interruption.*

## The Pattern

- Three phases: **spec**, then **plan review**, then **execute**
- The spec is a written agreement, not a long phase
- Execution starts only after the plan survives review
- Applies [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/) to agent work

## Spec Fields

- **Problem**: what is wrong or missing, not the solution
- **Constraints**: what must not be touched, what must keep working, what is already decided and why
- **Win definition**: the observable outcome that counts as done
- **Acceptance criteria**: each names the command or test that checks it
- **Out of scope**: work the agent must not start
- **Human checkpoints**: actions that stop for a decision ([Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/))
- **Abort criteria**: conditions that end the run early with a report
- **Stop condition**: all criteria pass, or a time limit is reached

## Plan Review Gate

- Have the agent ask clarifying questions first
- Have it propose 2-3 options with tradeoffs, then choose one
- Review the plan before execution: a human, or [Adversarial Review](/SHRINE/patterns/adversarial-review/)
- Ask "where will this stall?" and fix open questions in the spec, not in code
- Prior art: Claude Code [best practices](https://code.claude.com/docs/en/best-practices) separate exploring and planning from implementing

## The Plan Is a Living File

- Keep the plan in the repository, not in chat
- **Milestones**: each with its validation command
- **Progress**: a checklist updated as work lands
- **Decision log**: each decision and its reason; stops the next session from reopening it
- **Surprises**: findings that changed the plan
- Write it for a reader with only the working tree and the plan
- Prior art: OpenAI's [execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans) require Progress, Surprises & Discoveries, and Decision Log sections

## Milestones

- Small enough to verify in one [Verification Loop](/SHRINE/patterns/verification-loops/)
- Validation fails: stop and fix before the next milestone
- Use a prototype milestone to retire a large unknown early
- Prior art: Anthropic found long-running agents did better working [one feature at a time](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), committing and logging progress each step

## When to Use

- Multi-hour or [unattended runs](/SHRINE/patterns/unattended-runs/)
- Uncertain solution space
- Work that spans several context windows ([Context Handoff](/SHRINE/patterns/context-handoff/))

## When Not to Use

- One-line or throwaway changes
- Solution fully known and the human holds decisive context: prescribe, and say why
- Pure exploration: step 1 is the exploration
- The ticket already states problem, constraints, checkable criteria, and scope

## Worked Example

**Vague ticket**

- "Add rate limiting to the orders endpoint."

**Filled spec**

- **Problem**: one client can saturate `POST /orders` and slow every other client
- **Constraints**: no new infrastructure; existing API contract unchanged; limits must be configurable per environment
- **Win**: bursts over the limit get `429` with `Retry-After`; normal traffic is unaffected
- **Acceptance**: `make test` passes; new test `test_orders_429_after_limit` passes; load script `scripts/burst.sh` shows 429s only above the limit
- **Out of scope**: other endpoints, per-user quotas
- **Checkpoint**: any change to shared middleware config
- **Abort**: same test fails 3 times after distinct fixes
- **Stop**: all acceptance commands pass, or 4 hours

**"Where will this stall?" review**

- Limit per API key or per IP? Fixed: per API key; IP only for unauthenticated calls
- Counter store when running several instances? Fixed: existing shared cache; no new store
- Limit values? Fixed: 60 requests per minute default, set by config

**Plan excerpt**

- M1: limiter unit with tests; validate `pytest tests/limiter`
- M2: wire into `POST /orders`; validate `test_orders_429_after_limit`
- M3: burst script; validate `scripts/burst.sh`
- Decision log: "Fixed window over sliding window. Simpler, and burst tolerance is acceptable here."

## Review Card

- What will the agent ask first? Answer it in the spec
- Which criterion has no checking command?
- Which step has no cap, abort rule, or checkpoint?
- At hour 3 with tests red: retry, stop, or ask? The spec should already say

## Anti-patterns

- "Make it work" as the only criterion
- Spec prescribes the implementation instead of the problem
- Skipping plan review, then steering by correction in chat
- Plan written once, or kept only in chat

## Related

- [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/): the principle this implements
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): who reviews the plan
- [Verification Loops](/SHRINE/patterns/verification-loops/): checks each milestone
- [Adversarial Review](/SHRINE/patterns/adversarial-review/): machine review of the plan
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): what a good spec enables
- [Context Handoff](/SHRINE/patterns/context-handoff/): the plan file as handoff
- [Delegation Fit](/SHRINE/patterns/delegation-fit/): the small-task brief this spec extends
- [Reviewable Output](/SHRINE/patterns/reviewable-output/#staged-checkpoints): plan, interface, then implementation as staged reviews
