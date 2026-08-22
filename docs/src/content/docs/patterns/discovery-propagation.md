---
title: "Discovery Propagation"
description: "When agents find better paths, feed improvements back to the system."
---

*The system should learn from what it discovers.*

## The Pattern

When an agent discovers a more efficient approach, a missing capability, or an insight useful beyond the current task, it proposes (or adopts) that improvement for future use.

The system evolves through use, not just through deliberate redesign.

## What Gets Propagated

### Tool Improvements
- A skill that could be more efficient
- An MCP server missing a useful capability
- A prompt pattern that worked better than expected

### Environment Insights
- A convention that should be standardized
- A shortcut others would benefit from
- A failure mode worth guarding against

### Knowledge Capture
- Context that future tasks will need
- Decisions worth remembering
- Patterns worth encoding

## Implementation

1. **Detection**: Agent notices something worth propagating
2. **Proposal**: Surfaces the finding (don't silently mutate)
3. **Review**: Human or process evaluates the proposal
4. **Adoption**: Improvement is encoded for future use
5. **Propagation**: Change reaches the appropriate scope (team, org, etc.)

## Guardrails

- Propose, don't silently adopt (humans approve changes)
- Scope appropriately (not every insight is org-wide)
- Avoid churn (filter for meaningful improvements)
- Track provenance (where did this come from?)

## The Vision

A self-improving system where:
- Good patterns spread automatically
- Friction gets reported, not endured
- Agents contribute to their own tooling
- The system gets better through use

## Anti-patterns

- Insights that die with the session
- Silent mutations without review
- Over-propagation (noise drowns signal)
- No mechanism to receive proposals
