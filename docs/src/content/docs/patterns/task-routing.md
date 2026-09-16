---
title: "Task Routing"
description: "Match each task to the right model for cost and capability."
---

*Not every task needs your biggest model.*

## The Pattern

Route tasks to models based on complexity, cost, and capability requirements. Simple tasks go to cheap/fast models; complex tasks go to capable/expensive ones.

## When to Use

- Workloads with mixed complexity
- Cost is a constraint
- Latency matters for some paths
- You have access to multiple models

## Model Tiers (Example)

| Tier | Use For | Examples |
|------|---------|----------|
| Fast/Cheap | Classification, extraction, formatting, simple Q&A | Haiku, GPT-4o-mini |
| Balanced | Standard implementations, summarization, most tasks | Sonnet, GPT-4o |
| Capable | Complex reasoning, code review, architecture, security | Opus, o1, GPT-4.5 |

## Implementation

**Static routing**: Hard-code model per task type

```python
ROUTES = {
    "classify": "haiku",
    "implement": "sonnet",
    "review": "opus",
    "plan": "opus",
}
```

**Dynamic routing**: Let a cheap model triage

```
[Haiku] Given this task, classify complexity:
- SIMPLE: single-step, clear instructions
- MODERATE: multi-step, some ambiguity
- COMPLEX: cross-cutting, architectural, security-sensitive

Task: {task}
```

Then route based on classification.

## Tips

- Start with static routing; add dynamic when patterns emerge
- Log which model handled what to find misroutes
- Err toward more capable when uncertain (cost of wrong answer > cost of tokens)
- Fast models for fanout stages; capable models for synthesis

## Anti-patterns

- Using the biggest model for everything (cost explosion)
- Using the cheapest model for everything (quality collapse)
- Routing based on input length instead of task complexity
- No fallback when preferred model is unavailable

## Related Patterns

- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): fanout tasks often route to cheaper models
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): different stages may use different models
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): route each step inside a task, not just the task
