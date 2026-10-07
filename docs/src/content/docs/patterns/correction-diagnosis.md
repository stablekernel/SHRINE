---
title: "Correction Diagnosis"
description: "Trace each correction to the input that caused it, and fix that input instead of the output."
proposal: "https://github.com/stablekernel/SHRINE/pull/17"
last-reviewed: 2026-10-07
status: ratified
---

*A correction made twice is an input bug.*

## The Pattern

- The aim is a first result close to what you would have written; review is the backstop
- When you correct output, find the input that produced the miss
- Walk a fixed cause chain, upstream first, and stop at the first link that explains it
- Fix that input, capture the fix where it loads next time, then rerun

## When to Use

- You correct the same kind of output more than once
- Correcting output takes longer than writing it would have
- A session needs two corrections on one point

## When Not to Use

- Exploration, where variance is the point ([Reproducibility](/SHRINE/principles/reproducibility/))
- Throwaway output you will not reuse

## Step 0: One-Off or Repeated

- Before walking the chain, classify the miss with the [One-Off or Repeated](/SHRINE/principles/fail-fast-recover-smart/#one-off-or-repeated) rule
- One-off: repair once and move on
- Repeated: walk the chain below

## Cause Chain

Check top to bottom. An upstream cause usually makes downstream fixes useless.

| Link | Symptom | Cause | Fix |
|---|---|---|---|
| Task fit | Faster to have written it by hand | Wrong work delegated | Delegate less or pair: [Delegation Fit](/SHRINE/patterns/delegation-fit/) |
| Model fit | Shallow reasoning on a hard step | Tier too small for the step | Raise the tier: [Task Routing](/SHRINE/patterns/task-routing/#model-tiers), [Step-Level Routing](/SHRINE/patterns/step-level-routing/) |
| Context: missing | Ignored a repo convention | Convention not written down, or inconsistent | Write it down: [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/), [Standing Instructions](/SHRINE/stack/memory/#standing-instructions) |
| Context: wrong | Output got worse after material was added | Irrelevant or conflicting context | Prune context: [Memory & Context](/SHRINE/stack/memory/#in-session-context) |
| Framing | Solved the wrong problem | No problem statement or constraints | State the problem: [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/) |
| Examples | Wrong format or style | No exemplar to mirror | Add an exemplar: [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/#code-exemplars), the Mirror field in [Delegation Fit](/SHRINE/patterns/delegation-fit/#brief-shape) |
| Scope | Diff too large to review | Task too large for one brief | Split the task: [Agent Architecture](/SHRINE/stack/agent-architecture/#task-boundaries), [Delegation Fit](/SHRINE/patterns/delegation-fit/#sizing) |
| Execution | Wandered mid-task | No plan review or milestone | Add a plan review: [Spec, Then Build](/SHRINE/patterns/spec-then-build/#plan-review-gate) |
| Verification | Plausible code that does not run | No runnable check | Add a runnable check: [Verification Loops](/SHRINE/patterns/verification-loops/) |
| Feedback | Same fix made in two sessions | Correction never captured | Capture the fix: [Discovery Propagation](/SHRINE/patterns/discovery-propagation/) |

## Session Rule

- Two corrections on the same point: stop correcting in chat
- Rewrite the brief with what you learned, then start a fresh session
- Failed attempts left in context steer the next attempt ([Memory & Context](/SHRINE/stack/memory/#in-session-context))
- Prior art: Claude Code [best practices](https://code.claude.com/docs/en/best-practices) give the same rule: after two failed corrections, clear and write a better initial prompt

## Capture

- Route the fix to its destination ([Discovery Propagation](/SHRINE/patterns/discovery-propagation/#where-lessons-land))
- A convention that is not yet lint-enforceable goes in the repo's [standing instructions](/SHRINE/stack/memory/#standing-instructions)
- Personal standing instructions: edit directly; shared or team files: propose and pass review ([Discovery Propagation](/SHRINE/patterns/discovery-propagation/#guardrails))
- Capture at correction time; later, the detail is gone ([Memory & Context](/SHRINE/stack/memory/#cross-session-memory))

## Measure

- Tag each correction with its chain link
- After a bounded period, the most frequent tag is the next fix
- Protocol: [Individual Baseline](/SHRINE/stack/evaluation/#individual-baseline)

## Worked Example

- **Illustrative case** (composite session, not a transcript)
- **Task**: add a `GET /invoices/{id}/pdf` endpoint to a service with about 40 existing endpoints
- **Prompt**: "Add an endpoint that returns the invoice as a PDF"
- **Corrections**, each classified by [Step 0](#step-0-one-off-or-repeated):
  1. PDF footer shows the wrong page count; no repo convention involved (one-off: repaired once with the failing test output)
  2. Returned errors as plain strings; the repo wraps errors in `apperr.New`, and last week's endpoint got the same correction (repeated: matches a known convention, second time; Context: missing)
- **Response**: stop correcting; the convention exists only in reviewers' heads
- **Input fix**: one line proposed to the repo's standing instructions, "Wrap errors with `apperr.New`"; once merged, it loads every session
- **Rerun** in a fresh session, same prompt: no corrections
- **Minutes** (illustrative; 40 by hand):

| Path | Minutes | Against 40 by hand |
|---|---|---|
| First attempt, stopped at the repeated miss | 2 prompt + 43 review and correction = 45 | 5 worse |
| Input fix | 2 writing the line | n/a |
| Rerun | 2 prompt + 12 review = 14 | 26 better |
| **Total on this task** | 45 + 2 + 14 = 61 | 21 worse |

- **Verdict**: delegating lost on this task
- **Payoff**: the standing instruction loads next session, so the next similar endpoint costs about the rerun's 14 minutes

## Anti-patterns

- Steering by chat correction instead of fixing the brief
- Blaming the model before checking the inputs
- Adding more context to fix a context problem
- Never resetting a drifting session
- Verifying first and framing never: a check catches the miss, but the wrong problem still gets solved

## Related

- [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/): one-off vs repeated misses
- [Delegation Fit](/SHRINE/patterns/delegation-fit/): the first link in the chain
- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): where captured fixes land
- [Evaluation & Benchmarking](/SHRINE/stack/evaluation/): corrections per task as a metric
- [Reviewable Output](/SHRINE/patterns/reviewable-output/): cheaper review when a correction is still needed
- [Memory & Context Management](/SHRINE/stack/memory/): where captured fixes load next session
