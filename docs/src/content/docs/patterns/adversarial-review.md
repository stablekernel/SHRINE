---
title: "Adversarial Review"
description: "Using a second model or agent to challenge and verify output."
proposal: "https://github.com/stablekernel/SHRINE/commit/d5f06a07"
last-reviewed: 2026-10-07
status: ratified
---

*A reviewer whose job is to find holes, not to approve.*

## The Pattern

- After generation, a separate agent reviews the output
- Its job is to break the output, not to help it
- It looks for flaws, gaps, unstated assumptions, missed edge cases, and claims without evidence

## Reviewer Inputs

- **Give**: the output, plus the spec or acceptance criteria
- **Withhold**: the generator's reasoning and chat history
- Requirements let it judge correctness; withholding reasoning keeps it from inheriting the generator's framing

## Why a Separate, Skeptical Reviewer

- LLM evaluators can score their own outputs higher than equal-quality outputs from others ([Panickssery et al.](https://arxiv.org/abs/2404.13076))
- LLM judges show self-enhancement, position, and verbosity biases ([Zheng et al.](https://arxiv.org/abs/2306.05685))
- Agents asked to grade their own work tend to praise it, even when quality is mediocre ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps))
- Tuning a standalone evaluator to be skeptical was more tractable than making the generator self-critical (same source)

## How to Run It

- Agree what "done" means per chunk before any code is written
- Grade against a rubric with a hard threshold per criterion
- Any criterion below threshold fails the chunk, with specific feedback
- Exercise the running system where possible, not only the diff
- Source for all four: the generator/evaluator harness in [Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## Cost

- In that harness, on one app prompt, the full run took 6 hours; a single agent took 20 minutes ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps))
- The author reported the quality gap was immediately apparent; one prompt, not a benchmark
- Decide by task value: review where being wrong costs more than the review

## When to Use

- High-stakes output where a mistake is expensive
- Output trusted without further human review
- Plausible claims nobody has verified
- Subjective quality that a rubric can make gradable

## When Not to Use

- Low-stakes output
- Cheap deterministic checks already cover the risk ([Verification Loops](/SHRINE/patterns/verification-loops/))
- Nobody will act on the findings

## Worked Example

Prompt to the reviewer:

```
You are reviewing a pull request. Default to skepticism.
Inputs: the diff, and the ticket's acceptance criteria.
For each finding give: severity (high/medium/low), file:line,
the failure scenario (input -> wrong result), and a check
that would prove it. Do not report style preferences.
If you find nothing, say "no findings".
```

Output:

```
1. high  api/refund.py:42  refund > original charge is accepted
   verify: POST /refund amount=150 on a 100 charge -> expect 400
2. low   api/refund.py:77  log line omits refund id
   verify: grep log after refund -> id missing
```

- Each finding is then verified: run the check
- Finding 1 reproduces and blocks merge; finding 2 goes to the backlog

## Anti-patterns

- The same agent and context generating and reviewing
- A soft brief: "check if this looks good"
- The reviewer invents findings to look useful; require a verify step per finding
- Findings never triaged, or ignored because they are inconvenient

## Related

- [Self-Critique](/SHRINE/patterns/self-critique/): the cheaper, weaker in-context version
- [Verification Loops](/SHRINE/patterns/verification-loops/): review findings feed the next repair
- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): who triages what the reviewer finds
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): place review at the gate
- [Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/): agreement across models instead of challenge
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): review the plan before the build
- [Agent Architecture & Orchestration](/SHRINE/stack/agent-architecture/): where the adversarial topology fits
- [Iterative Refinement](/SHRINE/patterns/iterative-refinement/): self-improvement instead of external challenge
