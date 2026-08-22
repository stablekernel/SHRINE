---
title: "Cost Management"
description: "Token budgeting and cost-aware routing."
---

*Know what you're spending and where.*

## Cost Levers

### Model Selection
- Smaller models for simpler tasks
- Frontier models only when needed
- Routing logic to match task to model

### Context Efficiency
- Don't send what you don't need
- Compress/summarize long contexts
- Cache repeated context

### Retry Reduction
- Better prompts reduce retries
- Verification before generation
- Fail fast on bad inputs

### Batching
- Amortize overhead across requests
- Group similar tasks

## Budgeting Approaches

- **Per-task limits**: Cap tokens per operation
- **Per-user limits**: Fair allocation
- **Per-project limits**: Cost center tracking
- **Alert thresholds**: Catch runaway spend

## Tracking

- Tag requests with project/user/task type
- Dashboard spend by dimension
- Compare cost vs. value delivered

## Anti-patterns

- Optimizing cost without measuring value (TTV)
- No visibility into spend breakdown
- Hard limits that break critical paths
- Ignoring cost until the bill arrives
