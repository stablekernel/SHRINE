---
title: "Step-Level Routing"
description: "Route each step inside an agent trajectory to a model tier and reasoning effort."
proposal: "https://github.com/stablekernel/SHRINE/pull/13"
last-reviewed: 2026-10-07
status: ratified
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

## Worked Example

Fix a failing date-parsing bug. Tiers are generic labels ([Model Selection](/SHRINE/stack/models/)).

| # | Step | Tier | Effort | Why |
|---|------|------|--------|-----|
| 1 | Search for the parser and its callers | fast | low | Pattern lookup |
| 2 | Read the parser and failing test | fast | low | Summarize, no judgment |
| 3 | Plan the fix | capable | high | Root cause needs reasoning |
| 4 | Edit the parser | balanced | medium | Plan is concrete |
| 5 | Run tests | none | none | Tool call only |
| 6 | Edit after test failure (timezone case) | capable | high | Escalate: prior failure |
| 7 | Run tests | none | none | Pass |
| 8 | Review the diff against the plan | capable | medium | Judgment on the final change |

- One escalation, at step 6, triggered by the failed check at step 5
- Steps 1 and 2 hand the planner a summary, not raw files
- Log tier and effort per row to audit misroutes later

## Where the Router Lives

- **Harness**: sees step type and tool calls directly ([Harness Selection](/SHRINE/stack/harness/))
- **Gateway**: central policy, fallbacks, and limits across harnesses ([Model Selection](/SHRINE/stack/models/))

## Costs

- **Cache loss**: cache hits need an identical prompt prefix, and changing thinking or effort settings invalidates cached messages ([Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching))
- **Exception**: models that support a per-message effort change keep the cache; a top-level effort change always starts it over ([Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort#change-effort-mid-conversation-beta))
- **Cold cache on model switch**: assume the new model starts without the cached prefix
- **Misrouting**: a cheap model fails and the retry costs more than routing saved
- **Context transfer**: handoff between models resends or re-summarizes context

## Measuring

- Measure against [TTV](/SHRINE/principles/tokens-to-value/): cost per successful outcome, not per call
- Log the model and effort used for each step to find misroutes

## Anti-patterns

- Optimizing per-call price while total cost per outcome rises
- Switching models every step and paying for cold caches
- Flipping top-level effort every step; Anthropic advises holding it constant within a cached conversation ([Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort))
- Where the model supports it, change effort per message instead; that keeps the prompt cache
- Routing on input length instead of step type
- **Context loss on handoff**: the summary passed to the next model drops the constraint that mattered; see [Context Handoff](/SHRINE/patterns/context-handoff/)

## Prior Art

- **LLM routing**: [RouteLLM](https://arxiv.org/abs/2406.18665) learns to route between a strong and a weak model
- **Model cascades**: [FrugalGPT](https://arxiv.org/abs/2305.05176) escalates through models until an answer is good enough
- **Strong lead, lighter workers**: Anthropic's research system used a stronger lead model with lighter subagent models and beat the single strong agent on its internal eval ([source](https://www.anthropic.com/engineering/multi-agent-research-system))
- **Effort as a dial**: Anthropic documents effort as a per-request setting, suggests low effort for simple tasks such as subagents, and recommends adjusting it by task complexity ([source](https://platform.claude.com/docs/en/build-with-claude/effort))

## Related

- [Task Routing](/SHRINE/patterns/task-routing/): the coarser, per-task version
- [Verification Loops](/SHRINE/patterns/verification-loops/): failed checks are an escalation signal
- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): read-heavy workers are natural fast-tier steps
- [Context Handoff](/SHRINE/patterns/context-handoff/): what survives a model switch
- [Model Selection & Routing](/SHRINE/stack/models/): tiers and gateway
- [Chain of Thought](/SHRINE/patterns/chain-of-thought/): reasoning effort per step
