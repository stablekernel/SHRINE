---
title: "Human-in-the-Loop"
description: "Insert human checkpoints where AI judgment is insufficient."
---

*Know when to stop and ask.*

## The Pattern

Design explicit points where a human reviews, approves, or redirects AI work. Not every decision should be automated.

## When to Use

- High-stakes decisions (money, access, public statements)
- Ambiguous requirements where wrong interpretation is costly
- Novel situations outside training distribution
- Compliance or audit requirements

## Checkpoint Types

| Type | Trigger | Human Action |
|------|---------|--------------|
| Approval gate | Before irreversible action | Approve/reject/modify |
| Confidence threshold | Model uncertainty below threshold | Review and decide |
| Spot check | Random sample of outputs | Validate quality |
| Escalation | Anomaly detected | Investigate and resolve |

## Implementation

```python
def process_with_checkpoint(task):
    result = generate(task)
    
    if task.is_high_stakes:
        # Always require approval
        return await_human_approval(result)
    
    if result.confidence < 0.8:
        # Low confidence triggers review
        return await_human_review(result)
    
    # High confidence, low stakes: proceed
    return result
```

## Tips

- Make checkpoints non-blocking where possible (queue for async review)
- Show the human what they need to decide, not raw model output
- Track approval rates; if always approved, checkpoint may be unnecessary
- Track rejection reasons; patterns reveal prompt improvements

## Anti-patterns

- Checkpoint fatigue (too many, humans rubber-stamp)
- No context for human (just "approve this?")
- Blocking flows on low-stakes decisions
- No audit trail of what was approved and by whom

## Related Patterns

- [Verification Loops](/SHRINE/patterns/verification-loops/): automated verification reduces human load
- [Adversarial Review](/SHRINE/patterns/adversarial-review/): AI can pre-check before escalating to human
