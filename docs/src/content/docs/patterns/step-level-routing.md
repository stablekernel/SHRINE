---
title: "Step-Level Routing"
description: "Route each step inside an agent trajectory to a model tier and reasoning effort."
---

*Not every step of a task needs the model that planned it.*

## The Pattern

- Choose model tier and reasoning effort per request inside an agent trajectory
- Do not fix one model per agent or per task
- Two dials per step: **model tier** and **reasoning effort**

## Granularity Ladder

- **Session**: one model for everything
- **Agent**: one model per agent role
- **Task**: one model per task ([Task Routing](/SHRINE/patterns/task-routing/))
- **Step**: one decision per request (this pattern)

## When to Use

- Long trajectories mixing cheap steps (search, read) with hard ones (plan, review)
- The harness or gateway can switch models mid-trajectory
- You measure cost per outcome, so you can tell whether routing helps

## When Not to Use

- Short tasks where a switch costs more than it saves
- Workloads that depend on a long, warm prompt cache
- No outcome measurement to catch misroutes

## Routing Signals

- **Step type**: search, read, edit, plan, review
- **Tool about to be called**: file read vs. code edit vs. outward-facing action
- **Prior failure**: escalate after a failed check or retry
- **Uncertainty**: escalate on low confidence or conflicting signals

## Where the Router Lives

- **Harness**: sees step type and tool calls directly ([Harness Selection](/SHRINE/stack/harness/))
- **Gateway**: central policy, fallbacks, and budgets across harnesses ([Model Selection](/SHRINE/stack/models/))

## Costs

- **Cache loss**: prompt cache is per model; switching can lose cache hits
- **Misrouting**: a cheap model fails and the retry costs more than routing saved
- **Context transfer**: handoff between models resends or re-summarizes context

## Measuring

- Measure against [TTV](/SHRINE/principles/tokens-to-value/): cost per successful outcome, not per call
- Log the model and effort used for each step to find misroutes

## Anti-patterns

- Optimizing per-call price while total cost per outcome rises
- Switching models every step and paying for cold caches
- Routing on input length instead of step type

## Prior Art

- LLM routing: [RouteLLM](https://arxiv.org/abs/2406.18665) learns to route between a strong and a weak model
- Model cascades: [FrugalGPT](https://arxiv.org/abs/2305.05176) escalates through models until an answer is good enough

## Related Patterns

- [Task Routing](/SHRINE/patterns/task-routing/): the coarser, per-task version
- [Verification Loops](/SHRINE/patterns/verification-loops/): failed checks are an escalation signal
