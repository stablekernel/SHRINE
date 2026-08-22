---
title: "Chain of Thought"
description: "Force explicit reasoning steps before conclusions."
---

*Make the model show its work.*

## The Pattern

Instead of asking for an answer directly, prompt the model to reason through the problem step by step before reaching a conclusion.

## When to Use

- Complex reasoning tasks
- Math or logic problems
- Multi-step decisions
- When you need to verify the reasoning, not just the answer

## Implementation

Add explicit instructions:
- "Think through this step by step"
- "Before answering, reason through..."
- "Show your reasoning, then conclude"

## Why It Works

Models are more accurate when they externalize intermediate reasoning. The act of writing out steps helps catch errors that would slip through in a single jump to conclusion.

## Anti-patterns

- Using CoT for simple factual lookups (overhead without benefit)
- Not reading the reasoning (defeats the purpose)
- Accepting conclusions that don't follow from the stated reasoning
