---
title: "Structured Output"
description: "Force output into a defined schema."
---

*Get data, not prose.*

## The Pattern

Constrain model output to a specific format (JSON, XML, typed schema) that can be parsed programmatically.

## When to Use

- Output feeds into downstream code
- You need specific fields, not free-form text
- Validation and error handling matter
- Building pipelines where format consistency is critical

## Implementation

**Prompt-based:**
- "Respond only with valid JSON matching this schema: {...}"
- Provide examples of the exact format

**API-based:**
- Use structured output / JSON mode features when available
- Define schemas that the API enforces

## Tips

- Start with the simplest schema that works
- Include field descriptions in the schema
- Handle parsing failures gracefully
- Test edge cases (empty arrays, null values, long strings)

## Anti-patterns

- Over-complicated schemas (model struggles, errors increase)
- No validation on parse (trusting without checking)
- Forcing structure when prose would be clearer
- Schemas that fight the model's natural output style
