---
title: "Chain of Thought"
description: "Get reasoning before conclusions: a reasoning setting on models that think, a prompt instruction on models that don't."
proposal: "https://github.com/stablekernel/SHRINE/commit/d259f16b"
last-reviewed: 2026-10-07
status: ratified
---

*Make the model reason before it answers.*

## The Pattern

- Get the model to reason through the problem before it concludes
- **Reasoning models** (built-in thinking): raise the reasoning-effort setting first ([Model Selection](/SHRINE/stack/models/#selection-criteria)); do not prompt for steps
- **Models without built-in reasoning**: ask for step-by-step reasoning in the prompt

## When to Use

- Complex reasoning tasks
- Math or logic problems
- Multi-step decisions
- When you need to verify the reasoning, not just the answer

## When Not to Use

- Simple lookups or formatting; overhead without benefit
- A reasoning model whose effort setting already covers the step
- Hand-written step lists for a reasoning model; its own plan often beats the prescribed one

## Implementation

**Reasoning models**

- Raise effort for hard steps; lower it for simple ones ([Step-Level Routing](/SHRINE/patterns/step-level-routing/))
- Prefer general instructions ("think thoroughly about edge cases") over prescribed steps ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))
- Skip "think step by step"; these models reason internally, and the instruction can hurt ([OpenAI](https://developers.openai.com/api/docs/guides/reasoning-best-practices))
- Some current models may decline a prompt that asks them to write their reasoning out in the answer ([Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))

**Models without built-in reasoning**

- "Think through this step by step"
- "Before answering, reason through..."
- "Show your reasoning, then put the final answer in `<answer>` tags"

## Worked Example

- **Illustrative case** (hypothetical)
- **Task**: decide whether a schema migration is safe to run without downtime
- **Small model, no built-in reasoning**: direct prompt answers "safe"; adding "list each table lock the migration takes, then decide" surfaces a full-table lock and flips the answer
- **Reasoning model**: the same step list adds nothing; raising effort from low to high and asking it to "consider locking and replication lag" gets the same catch

## Why It Works

Models are more accurate when they work through intermediate steps. Writing out steps helps catch errors that would slip through in a single jump to a conclusion. Reasoning models do this internally, so the lever moves from the prompt to the setting.

## Anti-patterns

- Using CoT for simple factual lookups (overhead without benefit)
- Prompting a reasoning model to "think step by step" instead of raising effort
- Not reading the reasoning (defeats the purpose)
- Accepting conclusions that don't follow from the stated reasoning

## Related

- [Model Selection & Routing](/SHRINE/stack/models/): reasoning-effort settings per model
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): raise effort only for hard steps
- [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/): reason about the problem before the fix
