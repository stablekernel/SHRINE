---
title: "Mechanical Scaffolding"
description: "Build repeatable structure once, fill with context each time."
---

*Pay for structure once, pay for content every time.*

## The Pattern

Separate what is REPEATABLE (structure, format, fields, validation) from what is VARIABLE (context, content, specifics). Build the scaffold in code. Let the LLM fill it.

## When to Use

- You explain the same format repeatedly
- Output shape is predictable across uses
- Validation rules exist and can be encoded
- You copy-paste between prompts

## Implementation

**Without scaffolding (every prompt):**
```
Create a Jira ticket for this bug. Include:
- Summary (under 80 chars)
- Description with context
- Acceptance criteria as checkboxes
- Priority suggestion
- Labels

The bug is: users can't log in after password reset...
```

Token cost: ~150 tokens for structure + content tokens

**With scaffolding (code handles structure):**
```python
# scaffold.py (runs locally, zero tokens)
def format_ticket(summary, description, criteria, priority, labels):
    return {
        "fields": {
            "summary": summary[:80],
            "description": format_adf(description),
            "customfield_acceptance": criteria,
            ...
        }
    }
```

```
# LLM prompt (each use)
Given this bug report, extract:
- one-line summary
- technical description
- acceptance criteria (list)
- suggested priority

Bug: users can't log in after password reset...
```

Token cost: ~50 tokens for extraction + content tokens

**Savings**: 60%+ on structure tokens, compounding across every use.

## Examples

- **Jira tickets**: fields, formatting, ADF structure
- **PR bodies**: sections, checklists, evidence tables
- **Status reports**: headers, bullet constraints, recipient targeting
- **Code reviews**: checklist structure, severity levels
- **Release notes**: categorization, formatting, audience

## When NOT to Use

- One-off tasks (no repetition to amortize)
- Exploratory work where format is unknown
- Tasks where the LLM should invent the structure

## Tips

- Start with the hardest constraint (the part you always have to re-explain)
- Move validation to the scaffold, not the prompt
- Version your scaffolds like code
- Measure token savings to prove ROI

## Related Patterns

- [Structured Output](/SHRINE/patterns/structured-output/): the schema; scaffolding is the mechanism
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): scaffolds often form pipeline stages
- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): scaffold improvements propagate to all uses
