---
title: "Self-Critique"
description: "Have the model evaluate its own output against criteria."
proposal: "https://github.com/stablekernel/SHRINE/commit/d259f16b"
last-reviewed: 2026-10-07
status: ratified
---

*Built-in quality check.*

## The Pattern

After generating output, prompt the same or a follow-up call to critique the output against specific criteria, then revise based on the findings.

## What the Evidence Says

**For:**
- Self-Refine (generate, self-feedback, refine with one model) improved results across 7 tasks, about 20% absolute on average ([Madaan et al., 2023](https://arxiv.org/abs/2303.17651))
- Its tasks were mostly generation work with clear quality criteria, such as dialog responses and code readability

**Against:**
- Without external feedback, models struggle to self-correct reasoning, and performance sometimes degrades after self-correction ([Huang et al., ICLR 2024](https://arxiv.org/abs/2310.01798))

**Takeaway:**
- Self-critique helps most when criteria are concrete or an external signal exists
- It is weakest when the model must judge its own reasoning with nothing to check against

## When to Use

- Quality-sensitive outputs with criteria you can write down
- Style, completeness, and format checks
- When external feedback is available to ground the critique (test results, linter output, a validator)
- As a lighter alternative to Adversarial Review on low-stakes work

## When Not to Use

- Reasoning correctness with no external signal (math, logic, factual claims): the model tends to confirm or break its own answer
- High-stakes output: use [Adversarial Review](/SHRINE/patterns/adversarial-review/) or deterministic checks
- Simple tasks where a critique pass adds tokens without adding value

## Implementation

Two-phase approach:
1. Generate initial output
2. "Review this output against [checklist]. List each failed item with evidence. Then provide a revised version."

Ground the critique:
- Replace "is this good?" with a checklist of yes/no items
- Feed in external results (failing tests, validator errors) as part of the critique input

## Worked Example

Task: write a PR description from a diff.

**Critique checklist:**
- Does the summary say what changed in one line?
- Does every claimed change appear in the diff?
- Is every file with a behavior change mentioned?
- Are test commands listed, and do they exist in the repo?
- Is the body under 40 lines?

**Critique output:**
- Fail: claims "adds retry to upload client"; diff shows no retry change
- Fail: `config/limits.yaml` changed but is not mentioned
- Pass: summary, length

**Revision:**
- Remove the retry claim
- Add one bullet for the limit change

**Why it works here:**
- Each item checks against the diff, an external artifact
- "Does every claim appear in the diff" is checkable; "is this accurate" is not

## Limitations

- Models have blind spots about their own errors
- Self-critique is weaker than external review
- Vague criteria produce vague critique

## Related Patterns

- [Verification Loops](/SHRINE/patterns/verification-loops/): external checks as the feedback signal
- [Adversarial Review](/SHRINE/patterns/adversarial-review/): an external skeptic instead of self-review
- [Iterative Refinement](/SHRINE/patterns/iterative-refinement/): multiple passes with different focuses
