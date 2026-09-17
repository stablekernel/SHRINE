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
- Retry with the same input only for transient failures (rate limits, timeouts, outages), with backoff
- Never resend the same input after a refusal or bad output; resending does not address the cause
- Repair bad output by changing the input: feed the failure back inside a capped [Verification Loop](/SHRINE/patterns/verification-loops/)
- When the loop cap is hit, fall back rather than loop again
- Surface actionable errors: what failed, what was tried, what to do next

## Retry vs Repair

| Failure | Response | Input changes? | Bounded by |
|---|---|---|---|
| Rate limit, timeout, outage | Back off, retry | No | Retry cap, timeout |
| Output fails a check | Feed errors back, regenerate | Yes | Loop cap, budget |
| Invariant violated mid-run | Abort the step | n/a | Immediate |
| Refusal of a valid request | Rephrase or fall back | Yes, or skip | Loop cap |

## In Practice

An unattended run that generates a migration file and a test for it.

- **Budget**: session ceiling set before start; the run aborts when spend crosses it
- **Transient**: a rate-limit error triggers backoff and a same-input retry, at most 3 attempts
- **Repair**: the generated test fails; the failing assertion goes back to the model as new input; loop cap 3
- **Invariant**: the migration may touch only the tables named in the task; any other table aborts the step at once, no retry
- **Stop**: attempt 3 still fails the test
- **Fallback**: no PR is opened; the run reports an honest error
  - What failed: `test_migration_rollback` assertion on column type
  - What was tried: 3 repair attempts, each error message included
  - Spend: tokens used against the session budget
  - Next step: a human reviews the column type decision
- See [Unattended Runs](/SHRINE/patterns/unattended-runs/) for running this without a human watching

## Implemented By

- [Structured Output](/SHRINE/patterns/structured-output/): schemas make bad output detectable
- [Verification Loops](/SHRINE/patterns/verification-loops/): bounded generate-verify-fix
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): budgets and stop conditions when no one is watching
- [Cost Management](/SHRINE/stack/cost-management/): budgets and alert thresholds
- [Observability & Logging](/SHRINE/stack/observability/): make failures visible

## Open Questions

- Which failure classes are retriable vs terminal?
- What default timeout and cost ceiling does an agent task get, and who can override?

Proposal: [Discussion #7](https://github.com/stablekernel/SHRINE/discussions/7)
