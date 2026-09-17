---
title: "Model Selection & Routing"
description: "Choosing the right model for the right task, and the policy and gateway that enforce it."
---

*Pick models on your evals and cost per win, not on habit or headlines.*

## What This Covers

- **Model roster**: the small set of models your org approves, grouped into tiers
- **Routing policy**: which tier handles which work, when to escalate, what to fall back to
- **Gateway**: the shared layer that enforces the policy across harnesses
- Model names change every few months; the slot and its rules should not

## Key Principles

- Use the smallest model that reliably succeeds at the task
- Route by task complexity, not by habit
- Re-evaluate routing decisions as model capabilities evolve

## Selection Criteria

- **Capability on your evals**: pass rate on your own cases ([Evaluation](/SHRINE/stack/evaluation/)), not a public leaderboard
- **Cost per win, not per call**: tokens plus human attention per accepted outcome ([TTV](/SHRINE/principles/tokens-to-value/))
- **Latency**: time to first token and total time, for interactive paths
- **Context length**: usable length on your inputs, not the advertised maximum
- **Tool-use reliability**: correct tool choice and valid arguments across many turns
- **Reasoning effort dial**: whether effort is adjustable per request, and what each level costs
- **Data handling**: retention, training use, region, and compliance terms
- **Availability and fallback**: rate limits, outage history, and a second source

## Tiers

| Tier | Typical work | Trade |
|------|--------------|-------|
| Fast | Classification, extraction, formatting, search and read steps | Lowest cost and latency; fails on ambiguity |
| Balanced | Standard implementation, summarization, most tasks | Default for day-to-day work |
| Capable | Planning, architecture, review, security, hard debugging | Highest cost per call; fewest retries on hard work |

## Routing Policy

- **Default tier**: one named default per workload class; deviations need a reason
- **Escalation triggers**: failed verification, repeated retry, low confidence, outward-facing or security-sensitive step ([Step-Level Routing](/SHRINE/patterns/step-level-routing/))
- **Fallback chain**: an ordered list per tier; on outage or rate limit, fail over or stop cleanly, never loop ([Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/))
- **Policy owner**: a named owner sets defaults; teams override within bounds ([Authority Cascade](/SHRINE/principles/authority-cascade/))

## Gateway Responsibilities

- **Central policy**: one place to change defaults and fallbacks for every harness
- **Budgets**: per-task and per-team caps enforced before the call ([Cost Management](/SHRINE/stack/cost-management/))
- **Fallbacks**: automatic failover along the configured chain
- **Logging**: model, version, and reasoning effort recorded on every call ([Observability](/SHRINE/stack/observability/))

## Re-evaluation

- Trigger on [Deliberate Currency](/SHRINE/principles/deliberate-currency/) tripwires, not on every release
- Rerun the eval suite on the candidate before switching
- Switch only when cost per win improves or holds at higher pass rate
- Recheck harness scaffolding too; a stronger model may make parts of it unnecessary ([example](https://www.anthropic.com/engineering/harness-design-long-running-apps))

## Worked Example

- **Workload**: ticket triage agent (read ticket, search code, draft a fix plan)
- **Policy**: fast tier for search and read steps; balanced tier drafts the plan; capable tier on a failed check
- **Fallback**: balanced tier falls back to a second provider's balanced model, then stops with a clear error
- **Gateway log**: model and effort per step, tagged with the ticket ID
- **Result to check**: pass rate and minutes of human review per triaged ticket, before and after

## Anti-patterns

- Defaulting to the biggest model by habit
- One model for every step of a long trajectory
- Choosing on per-call price or public leaderboards alone
- No fallback when the preferred model is unavailable
- Calling a floating model alias the provider can update, then chasing a regression nobody logged

## Related Patterns

- [Task Routing](/SHRINE/patterns/task-routing/): route per task
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): route per step inside a trajectory
- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): prove a model switch is safe

## Current Stack

*Document your org's current model roster and routing rules here.*
