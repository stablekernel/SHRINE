---
title: "Cost Management"
description: "Track cost per accepted win: tokens plus human attention."
status: draft
---

*The cost of a win is tokens plus the human minutes it took.*

## What Cost Means Here

- The unit is cost per accepted win, not monthly spend ([TTV](/SHRINE/principles/tokens-to-value/))
- A win costs tokens plus human attention: steering, review, QA, rework
- Monthly spend is a lagging view; it cannot tell a cheap win from a cheap failure
- Human review and QA time count as cost, often the larger share
- One team building with agents found human QA capacity became the bottleneck, with human time and attention the fixed constraint ([OpenAI](https://openai.com/index/harness-engineering/))

## Tracking

- Tag every model call with an outcome ID (ticket, PR, eval run)
- Log human interventions and active minutes per outcome
- Mark each outcome accepted as delivered, accepted after correction, or rejected; both accepted states count as wins and are reported apart ([Evaluation](/SHRINE/stack/evaluation/#outcome-metrics))
- Put tokens from failed or abandoned runs in a waste bucket, and drive it down
- Report tokens per win and minutes per win side by side ([Observability](/SHRINE/stack/observability/))

## Limits

- **Retry cap**: a fixed number of attempts before escalation
- **Time limit**: a wall-clock cap on one agent run ([Unattended Runs](/SHRINE/patterns/unattended-runs/))
- **Breach behavior**: stop, save state, and report; never retry silently past a limit ([Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/))
- Exempt critical paths explicitly, with a named owner

## Cost Levers

### Routing
- Cheaper tiers for simple tasks and steps; capable tiers where they cut retries ([Task Routing](/SHRINE/patterns/task-routing/), [Step-Level Routing](/SHRINE/patterns/step-level-routing/))

### Context Efficiency
- Send only what the step needs
- Cache stable context such as system prompts and docs ([Memory & Context](/SHRINE/stack/memory/))
- Summarize long histories instead of resending them

### Retry Reduction
- Validate inputs before generation; reject bad inputs before spending tokens
- Clear specs cut rework ([Spec Then Build](/SHRINE/patterns/spec-then-build/))
- Cheap deterministic checks before expensive model checks ([Verification Loops](/SHRINE/patterns/verification-loops/))

### Fanout
- Parallel agents multiply tokens; justify fanout by task value ([Subagent Fanout](/SHRINE/patterns/subagent-fanout/))
- One vendor measured agents at about 4x the tokens of chat, and multi-agent systems at about 15x ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system))

### Batching
- Group similar tasks to amortize setup overhead

## Worked Example

- **Documented case**: one prompt run solo and through a planner, generator, and evaluator harness ([Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps))
  - Solo: 20 minutes; the core feature did not work
  - Full harness: 6 hours; the core feature worked
  - The cheaper run was not the cheaper win; a broken result is all waste
- **Illustrative comparison** (hypothetical numbers, same task):
  - Fast-tier loop: 3 attempts, 40k tokens, 25 human minutes to review and fix
  - Capable tier: 1 attempt, 60k tokens, 5 human minutes to review
  - The capable run uses more tokens and costs less per win once minutes count
- Use your own logs to fill in the real numbers before deciding

## Anti-patterns

- Optimizing cost without measuring value ([TTV](/SHRINE/principles/tokens-to-value/))
- No visibility into spend breakdown
- Hard limits that break critical paths
- Ignoring cost until the bill arrives
- Cutting tokens while human attention per win rises

## Related

- [Evaluation & Benchmarking](/SHRINE/stack/evaluation/): pass rates that define a win
- [Model Selection & Routing](/SHRINE/stack/models/): gateway limits and tiers
