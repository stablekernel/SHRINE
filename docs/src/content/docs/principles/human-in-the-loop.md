---
title: "Human in the Loop"
description: "Define where human judgment is required, and make those checkpoints fast."
proposal: "https://github.com/stablekernel/SHRINE/discussions/8"
last-reviewed: 2026-10-07
status: ratified
---

*Automation with oversight, not automation as abandonment.*

## The Principle

- Write down which decisions need a human
- Make every checkpoint fast to clear

## Why

- Too little oversight ships irreversible mistakes (external email, destructive migration, compliance breach)
- Too much oversight makes humans the bottleneck and review becomes rubber-stamping
- The root failure is an undefined boundary; undefined lines drift toward convenience

## When to Require a Human

- **High stakes**: hard-to-reverse actions, external communication, significant spend, safety-critical changes
- **Low confidence**: high uncertainty, novel situations, conflicting signals
- **Policy**: compliance mandates, audit trails, formal approvals

## Making Review Efficient

- Put the relevant context next to the decision
- Present a recommended action, not an open question
- Make approve/reject a single step
- Batch similar low-risk decisions
- For code and documents, ask for output shaped for review ([Reviewable Output](/SHRINE/patterns/reviewable-output/))

## Implemented By

- [Adversarial Review](/SHRINE/patterns/adversarial-review/): machine review before human review
- [Verification Loops](/SHRINE/patterns/verification-loops/): only verified output reaches the checkpoint
- [Reviewable Output](/SHRINE/patterns/reviewable-output/): small diffs, evidence, and staged checkpoints
- [Agent Architecture](/SHRINE/stack/agent-architecture/): trust and validation boundaries

## Open Questions

- Which signals show a checkpoint is mis-tuned (near-100% approval, queue latency)?
- When no reviewer is available, does the system block, fall back, or queue?

Proposal: [Discussion #8](https://github.com/stablekernel/SHRINE/discussions/8)
