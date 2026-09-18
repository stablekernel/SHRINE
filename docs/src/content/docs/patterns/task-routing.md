---
title: "Task Routing"
description: "Match each task to the smallest model tier that reliably succeeds."
---

*Not every task needs your biggest model.*

## The Pattern

- Route each task to a model tier by complexity, cost, and capability needs
- Default to the smallest tier that reliably succeeds on your evals
- Escalate when the router is uncertain or a check fails
- Route to tier names in code; map tiers to models in one config

## When to Use

- Workloads with mixed complexity
- Cost or latency is a constraint on some paths
- You have access to more than one model
- You can measure outcomes per task type ([Evaluation](/SHRINE/stack/evaluation/))

## When Not to Use

- **Single-model access**: nothing to route between
- **Uniform workload**: every task needs the same tier, so a router adds only failure modes
- **No outcome measurement**: you cannot see misroutes, so savings are guesses

## Model Tiers

Tiers are stable; the models behind them change. Keep the tier-to-model map current per [Deliberate Currency](/SHRINE/principles/deliberate-currency/) and [Model Selection](/SHRINE/stack/models/).

| Tier | Use For |
|------|---------|
| fast | Classification, extraction, formatting, simple Q&A |
| balanced | Standard implementations, summarization, most tasks |
| capable | Complex reasoning, code review, architecture, security |

## Implementation

**Static routing**: map task types to tiers.

```python
ROUTES = {
    "classify": "fast",
    "implement": "balanced",
    "review": "capable",
    "plan": "capable",
}

# One place maps tiers to current model IDs; update it on each model review.
TIER_MODELS = load_config("model_tiers.yaml")
```

**Dynamic routing**: a fast-tier call triages first.

```
Classify this task's complexity:
- SIMPLE: single step, clear instructions
- MODERATE: multi-step, some ambiguity
- COMPLEX: cross-cutting, architectural, security-sensitive
- UNSURE: not enough information

Task: {task}
```

- SIMPLE to fast, MODERATE to balanced, COMPLEX to capable
- UNSURE routes up one tier, not down

## Smallest Reliable Tier vs. Escalation

- Pick the tier from evals, not from habit or fear
- "Reliable" means it passes your checks at the rate you need
- When the router is uncertain, escalate: a wrong answer usually costs more than the tokens saved
- After a failed check, retry one tier up, not the same tier again
- Both rules serve [Tokens to Value](/SHRINE/principles/tokens-to-value/): cost per verified outcome, including human rework

## Worked Example

Support ticket triage.

1. Fast tier labels each ticket: `password_reset`, `billing_dispute`, `bug_report`, `unsure`
2. `password_reset` goes to the fast tier with a template reply
3. `billing_dispute` and `bug_report` go to balanced
4. `unsure` goes to capable
5. Every routed ticket writes a misroute log line:
   ```json
   {"ticket": 4812, "label": "password_reset", "tier": "fast",
    "outcome": "reopened", "final_tier": "balanced"}
   ```
6. Weekly review: reopened `password_reset` tickets cluster on one cause and resolve on balanced
7. Cause: SSO users; add an `sso_login` label routed to balanced
8. Reopen rate is tracked as the eval for the next change

## Tips

- Start static; add dynamic routing when misroute logs show a pattern
- Fast tiers suit fanout workers; capable tiers suit synthesis
- Keep a fallback tier for when the preferred model is unavailable

## Anti-patterns

- Biggest model for everything (cost explosion)
- Cheapest model for everything (quality collapse)
- Routing on input length instead of task complexity
- Product IDs scattered through code, so model changes need a code search
- No fallback when the preferred model is unavailable

## Related Patterns

- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): fanout tasks often route to cheaper tiers
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): stages may use different tiers
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): route each step inside a task
