---
title: "Fail Fast, Recover Smart"
description: "Design for failure, not just success."
---

*Failures will happen. Plan for them.*

## The Principle

AI systems fail in ways traditional software doesn't. Design for graceful degradation, clear failure signals, and efficient recovery.

## Failure Modes

- Model returns wrong/harmful output
- Model refuses valid request
- Context window exceeded
- Rate limits hit
- Timeout/latency spikes
- Cost runaway

## Fail Fast

- Validate inputs before expensive operations
- Set timeouts and budgets
- Check intermediate results
- Don't retry indefinitely

## Recover Smart

- Fallback strategies (simpler model, cached response)
- Partial results better than no results
- Clear error messages for humans
- Automatic retry with backoff where appropriate

## Observable Failures

- Log failure context (not just "failed")
- Alert on unusual patterns
- Track failure rates by type
- Learn from failures (postmortems)

## Anti-patterns

- Silent failures (looks like success, isn't)
- Infinite retries (cost explosion)
- Generic error messages ("something went wrong")
- No fallback plan
