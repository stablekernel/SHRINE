---
title: "Verification Loops"
description: "Generate, run a check, and repair until it passes or a stop condition fires."
proposal: "https://github.com/stablekernel/SHRINE/commit/d259f16b"
last-reviewed: 2026-10-07
status: ratified
---

*Trust but verify. Then fix what fails.*

## The Pattern

- Generate output, then run a check
- On failure, feed the specific failure back and try again
- Stop when the check passes or a stop condition fires

## Repair, Not Retry

- **Repair**: the failure (error, failing test, diff) is new input to the next attempt
- **Retry**: the same input sent again, hoping for a different result
- A verification loop repairs; blind retry of bad output is what [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/) rules out
- Agents need ground truth from the environment, such as test results, at each step ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents))

## Checks, Strongest First

- **Deterministic**: compile, tests, lint, typecheck, schema validation
- **End-to-end**: drive the running system the way a user would
- **External reviewer**: a separate agent or human grades against criteria ([Adversarial Review](/SHRINE/patterns/adversarial-review/))
- **Self-check**: the generator judges its own work; weakest, since agents tend to praise their own output ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps))

## Why a Runnable Check

- Without one, "looks done" is the only stop signal
- The human becomes the verification loop ([Claude Code best practices](https://code.claude.com/docs/en/best-practices))

## Acceptance Criteria

- Each criterion names the command or test that proves it
- Require evidence: the command and its output, not a claim of success
- Keep the acceptance list as structured data; the agent may only flip a pass/fail field
- The agent may not delete or edit tests; one harness used JSON because the model overwrote it less often than Markdown ([Anthropic, long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))

## Milestones

- Validate each milestone; if validation fails, fix before moving on ([OpenAI, long-horizon Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex))
- Run a smoke test at session start to catch inherited breakage ([Anthropic, long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))

## Stop Conditions

- Max iterations reached ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents))
- Same error twice in a row; treat it as a repeated miss and fix the input ([One-Off or Repeated](/SHRINE/principles/fail-fast-recover-smart/#one-off-or-repeated))
- Time limit hit
- On stop: report what failed, what was tried, and the current state

## Implementation

```
feedback = none
last_error = none
for attempt in 1..MAX:
  output = generate(task, feedback)
  result = run_checks(output)          # deterministic first
  log(attempt, result.summary)
  if result.passed: return output, result.evidence
  if result.error == last_error or time_limit_exceeded: break
  feedback = result.error               # specific, untruncated
  last_error = result.error
escalate(failures, attempts, state)
```

## When to Use

- Output has machine-checkable criteria
- First-attempt accuracy is not reliable enough
- A check costs less than the error it catches

## When Not to Use

- No machine-checkable criteria exist
- The check costs more than the error
- The failure is a spec problem; fix the spec, not the output
- Subjective quality without a rubric; use [Adversarial Review](/SHRINE/patterns/adversarial-review/)

## Worked Example

Task: fix failing test `test_invoice_total_rounding`. Cap: 3 attempts.

```
attempt 1: pytest tests/test_invoice.py -> FAIL expected 10.01, got 10.0
attempt 2: pytest tests/test_invoice.py -> FAIL expected 10.01, got 10.0
stop: same error twice
escalation: rounding happens in currency lib, not invoice code;
  tried ROUND_HALF_UP in invoice.py twice; branch fix-rounding at a9c1
```

- The human sees the cause in one read and decides whether to patch the library call site
- No fourth attempt burns tokens on the same wrong file

## Pitfalls

- The loop edits the test until it passes
- Error output truncated, so the model repairs the wrong thing
- The prompt grows every iteration; send the latest failure, not the history

## Related

- [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/): bounded repair, no blind retry
- [Structured Output](/SHRINE/patterns/structured-output/): schemas make output checkable
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): where escalation lands
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): a failed check can escalate the model tier
- [Adversarial Review](/SHRINE/patterns/adversarial-review/): the check when no test exists
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): a check per milestone
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): loops inside a stage gate
- [Self-Critique](/SHRINE/patterns/self-critique/): review when no runnable check exists
