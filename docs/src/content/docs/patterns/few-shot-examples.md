---
title: "Few-Shot Examples"
description: "Guide output format and style with concrete examples."
proposal: "https://github.com/stablekernel/SHRINE/commit/d259f16b"
last-reviewed: 2026-10-07
status: ratified
---

*Show, don't just tell.*

## The Pattern

Include 2-5 examples of the input/output format you want before asking for the actual task. The model learns the pattern from examples.

## When to Use

- Specific output formats (JSON, markdown structures)
- Consistent style or tone
- Domain-specific conventions
- When verbal descriptions of format are ambiguous

## When Not to Use

- The format is fully specified by a schema; use [Structured Output](/SHRINE/patterns/structured-output/)
- Reasoning models on tasks they handle zero-shot; try without examples first ([OpenAI](https://developers.openai.com/api/docs/guides/reasoning-best-practices))
- You have only one example and it is an edge case

## Implementation

Structure as:
```
Here are examples of the format I need:

Input: [example 1 input]
Output: [example 1 output]

Input: [example 2 input]
Output: [example 2 output]

Now, apply this to:
Input: [actual input]
Output:
```

## Code Exemplars

In a codebase, the best example is code that already exists.

- Point at a file or function to mirror instead of pasting examples ([Delegation Fit: Mirror](/SHRINE/patterns/delegation-fit/#brief-shape))
- Pick an exemplar that follows current conventions, not legacy code
- Name what to copy (error handling, test entry point) and what to change
- One good exemplar in the repo usually beats three pasted snippets in the prompt

## Worked Example

- **Illustrative case** (hypothetical)
- **Task**: write release-note lines from merged PR titles
- **Without examples**: mixed tense, some lines lead with the ticket ID, some with the component
- **With three examples** (`Fix: checkout no longer double-charges on retry (PAY-112)`): every line follows the shape on the first run
- **Code variant**: "add a handler; mirror `handlers/refund.go`" replaces pasted examples and keeps the prompt short

## Tips

- Examples should be representative, not edge cases
- Vary the examples enough to show the pattern, not memorization
- Keep examples concise; long examples waste context
- Bad examples teach bad patterns

## Anti-patterns

- Too many examples (diminishing returns, context waste)
- Examples that contradict each other
- Examples that are too similar (model over-fits to specifics)
