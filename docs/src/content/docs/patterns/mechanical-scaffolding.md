---
title: "Mechanical Scaffolding"
description: "Build repeatable structure once, fill with context each time."
---

*Pay for structure once, pay for content every time.*

## The Pattern

Separate what is REPEATABLE (structure, format, fields, validation) from what is VARIABLE (context, content, specifics). Build the scaffold in code. Let the LLM fill it.

**Not the same as compensating scaffolding:**
- This pattern moves deterministic structure into code because code does it cheaper and more reliably
- Compensating scaffolding works around a model limitation and can decay as models improve ([Deliberate Currency](/SHRINE/principles/deliberate-currency/), [Glossary](/SHRINE/reference/glossary/))
- Mechanical scaffolds still deserve review on model changes, but they do not exist because the model is weak

## When to Use

- You explain the same format repeatedly
- Output shape is predictable across uses
- Validation rules exist and can be encoded
- You copy-paste between prompts

## When Not to Use

- One-off tasks (no repetition to amortize)
- Exploratory work where format is unknown
- Tasks where the LLM should invent the structure

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

- The model re-reads the format rules and must produce Jira formatting itself on every use

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

- The model returns plain fields; code applies the length limit, field mapping, and ADF formatting

**What changes in this example:**
- Formatting rules and output markup leave the prompt and the response
- Structure errors (wrong field names, broken ADF) move from model output to tested code
- Token savings depend on the prompt; measure your own before claiming them

**When the fill is invalid (scaffold rejects, loop repairs):**
```python
# scaffold validates; the model never sees formatting rules
def build_ticket(fields):
    errors = []
    if len(fields["summary"]) > 80:
        errors.append("summary exceeds 80 chars")
    if not fields["acceptance_criteria"]:
        errors.append("acceptance_criteria is empty")
    if fields["priority"] not in {"P1", "P2", "P3"}:
        errors.append("priority must be P1, P2, or P3")
    if errors:
        raise ScaffoldError(errors)
    return format_ticket(
        fields["summary"], fields["description"],
        fields["acceptance_criteria"], fields["priority"], fields["labels"],
    )

def ticket_from_bug(bug_report):
    feedback = None
    for attempt in range(3):
        fields = extract(bug_report, feedback)
        try:
            return build_ticket(fields)
        except ScaffoldError as e:
            feedback = f"Fix these fields: {e.errors}"
    raise EscalateToHuman(bug_report)
```

- Rejection messages name the field and the rule, so the repair is targeted
- The loop is capped; persistent failure goes to a person ([Verification Loops](/SHRINE/patterns/verification-loops/))

## Examples

- **Jira tickets**: fields, formatting, ADF structure
- **PR bodies**: sections, checklists, evidence tables
- **Status reports**: headers, bullet constraints, recipient targeting
- **Code reviews**: checklist structure, severity levels
- **Release notes**: categorization, formatting, audience

## Pitfalls

- **Scaffold drifts from the target schema**: the destination adds or renames a field and the scaffold keeps emitting the old shape; test the scaffold against the real schema
- **Validation duplicated in prompt and code**: the two copies disagree over time; keep rules in code and send only failures back to the model
- **Over-scaffolding exploratory work**: locking a format before it is understood forces bad structure; scaffold after the shape repeats

## Tips

- Start with the hardest constraint (the part you always have to re-explain)
- Move validation to the scaffold, not the prompt
- Version your scaffolds like code
- Measure token savings to prove ROI

## Related Patterns

- [Structured Output](/SHRINE/patterns/structured-output/): the schema; scaffolding is the mechanism
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): scaffolds often form pipeline stages
- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): a discovered improvement is proposed, reviewed, then lands in the shared scaffold
- [Verification Loops](/SHRINE/patterns/verification-loops/): the repair loop when a fill fails validation
