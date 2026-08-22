---
title: "Few-Shot Examples"
description: "Guide output format and style with concrete examples."
---

*Show, don't just tell.*

## The Pattern

Include 2-5 examples of the input/output format you want before asking for the actual task. The model learns the pattern from examples.

## When to Use

- Specific output formats (JSON, markdown structures)
- Consistent style or tone
- Domain-specific conventions
- When verbal descriptions of format are ambiguous

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

## Tips

- Examples should be representative, not edge cases
- Vary the examples enough to show the pattern, not memorization
- Keep examples concise; long examples waste context
- Bad examples teach bad patterns

## Anti-patterns

- Too many examples (diminishing returns, context waste)
- Examples that contradict each other
- Examples that are too similar (model over-fits to specifics)
