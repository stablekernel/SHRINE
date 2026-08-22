---
title: "Evaluation & Benchmarking"
description: "How do you know if your stack is working?"
---

*If you can't measure it, you can't improve it.*

## Why Evaluate

- Detect regressions before users do
- Compare alternatives objectively
- Justify changes with data
- Track TTV over time

## What to Measure

### Outcome Metrics
- Success rate (did it work?)
- Quality score (how good was it?)
- Time to completion
- Human intervention rate

### Cost Metrics
- Tokens per outcome
- Dollars per outcome
- Retry rate
- Context utilization

### Operational Metrics
- Latency (time to first token, total time)
- Error rate
- Availability

## Evaluation Types

- **Offline evals**: Run against a static dataset, compare outputs
- **Online evals**: Monitor production traffic
- **A/B tests**: Compare alternatives on live traffic
- **Human evals**: Expert judgment on quality

## Building an Eval Suite

*Document your org's evaluation approach here.*

## Anti-patterns

- Vanity metrics (measuring what's easy, not what matters)
- No baseline (can't tell if you're improving)
- Evaluating once (things drift)
- Over-fitting to evals (gaming the metric)
