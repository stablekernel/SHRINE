---
title: "Human in the Loop"
description: "When to require human approval or review."
---

*Automation with oversight, not abandonment.*

## The Principle

Not everything should be fully automated. Define where human judgment is required, and make those checkpoints efficient.

## When to Require Humans

### High Stakes
- Actions that are hard to reverse
- External-facing communication
- Decisions with significant cost
- Safety-critical operations

### Low Confidence
- Model uncertainty is high
- Edge cases outside training
- Novel situations
- Conflicting signals

### Policy Requirements
- Compliance mandates review
- Audit trail requirements
- Approval workflows

## Making Review Efficient

- Surface relevant context (don't make humans dig)
- Clear recommended action
- Easy approve/reject interface
- Batch similar decisions when appropriate

## Calibrating the Loop

- Too tight: Humans bottleneck everything
- Too loose: Errors reach production
- Track review rates and outcomes
- Adjust based on error patterns

## Anti-patterns

- Human review as theater (rubber stamping)
- No escalation path
- Hiding confidence from reviewers
- Reviewing everything equally
