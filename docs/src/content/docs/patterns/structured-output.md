---
title: "Structured Output"
description: "Force output into a defined schema."
---

*Get data, not prose.*

## The Pattern

Constrain model output to a defined format (JSON, XML, typed schema) that code can parse and validate.

- The schema is a contract between the model and downstream code
- Parsing proves shape; it does not prove the values are right

## When to Use

- Output feeds into downstream code
- You need specific fields, not free-form text
- Validation and error handling matter
- Pipeline stages depend on a consistent format

## When Not to Use

- Human-facing prose: a schema adds friction and flattens the writing
- Exploratory brainstorming: the shape of a good answer is not known yet
- One-off questions where a person reads the answer directly

## Enforcement Levels

**Prompt-only:**
- Describe the schema in the prompt and show an exact example
- Works with any model; nothing guarantees compliance
- Always parse and validate; expect occasional malformed output

**API-enforced:**
- Some providers constrain decoding to a supplied schema
- Example: OpenAI distinguishes JSON mode (valid JSON only) from Structured Outputs (valid JSON that adheres to the schema) ([OpenAI docs](https://platform.openai.com/docs/guides/structured-outputs))
- Even enforced output can still contain mistakes in values, and can come back as a refusal or truncated at the token limit ([OpenAI docs](https://platform.openai.com/docs/guides/structured-outputs))
- Enforcement removes shape errors; it does not remove the need to validate

## Worked Example

Extract invoice data from an email.

**Schema:**
```json
{
  "type": "object",
  "properties": {
    "vendor": { "type": "string" },
    "total": { "type": "number" },
    "currency": { "type": "string", "enum": ["USD", "EUR", "GBP"] },
    "due_date": { "type": ["string", "null"], "description": "ISO 8601 date, or null if not stated" }
  },
  "required": ["vendor", "total", "currency", "due_date"],
  "additionalProperties": false
}
```

- `currency` is an enum: `"US Dollars"` fails validation (and cannot be emitted at all under API enforcement)
- `due_date` is nullable and required: the model must say "not stated" explicitly instead of guessing or omitting

**Validate, then repair:**
```
for attempt in 1..3:
  raw = generate(prompt, schema)
  errors = schema_validate(raw) + invariant_checks(raw, source_email)
  if no errors: return raw
  prompt = prompt + "Fix these errors: " + errors
return failure  # surface to a human, do not pass bad data on
```

**Invariant checks (beyond the schema):**
- `total` is greater than zero
- `total` appears as a number in the source email
- `due_date`, if present, parses and is not before the email date

## Pitfall: Valid Schema, Wrong Values

- A response can pass the schema and still be wrong: `total: 1200` when the email says `$12,000`
- Schema validity checks shape; invariant checks catch semantic errors
- Fail loudly when invariants break; do not let plausible bad data flow downstream ([Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/))

## Tips

- Start with the simplest schema that works
- Include field descriptions in the schema
- Prefer enums and nullable fields over free strings and optional fields
- Test edge cases (empty arrays, null values, long strings)

## Anti-patterns

- Over-complicated schemas that are hard to fill correctly and hard to debug
- No validation on parse (trusting without checking)
- Treating a schema-valid response as a correct response
- Forcing structure where prose would be clearer

## Related Patterns

- [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/): code owns structure; the model fills fields
- [Verification Loops](/SHRINE/patterns/verification-loops/): the repair loop above
- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): structured fields make exact-match tests possible
