---
title: "Fail Fast, Recover Smart"
description: "Design AI systems for failure, not just success."
proposal: "https://github.com/stablekernel/SHRINE/discussions/7"
last-reviewed: 2026-09-16
---

*A confident wrong answer looks exactly like a right one.*

## The Principle

- Every component that calls a model knows what it does when the model is wrong, slow, or unavailable
- Failure handling is designed before shipping, not added by ops later

## Why

- AI fails silently and probabilistically; no exception fires
- Silent failures compound downstream and bury the cause
- Retry loops burn real money per iteration
- One confidently wrong answer costs more trust than an honest "I can't"

## AI-Specific Failure Modes

- Confident wrong or harmful output
- Refusal of a valid request
- Context overflow and silent truncation
- Rate limits and provider outages
- Latency spikes and timeouts
- Runaway cost from loops and retries

## Fail Fast

- Validate inputs and preconditions before the expensive call
- Set hard timeouts and per-request and per-session budgets
- Check intermediate output against schemas or invariants; abort on violation
- Cap retries; never retry an un-retriable failure

## Recover Smart

- Declare a fallback chain: cheaper model, cached response, static default, honest error
- Prefer partial results with a caveat over nothing
- Back off and retry only transient failures (429s, timeouts), never refusals or bad output
- Surface actionable errors: what failed, what was tried, what to do next

## Implemented By

- [Structured Output](/SHRINE/patterns/structured-output/): schemas make bad output detectable
- [Verification Loops](/SHRINE/patterns/verification-loops/): bounded generate-verify-fix
- [Cost Management](/SHRINE/stack/cost-management/): budgets and alert thresholds
- [Observability & Logging](/SHRINE/stack/observability/): make failures visible

## Open Questions

- Which failure classes are retriable vs terminal?
- What default timeout and cost ceiling does an agent task get, and who can override?

Proposal: [Discussion #7](https://github.com/stablekernel/SHRINE/discussions/7)
