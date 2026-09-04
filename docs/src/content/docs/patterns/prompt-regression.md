---
title: "Prompt Regression Testing"
description: "Detect when prompt changes break existing behavior."
---

*Prompts are code. Test them like code.*

## The Pattern

Maintain a suite of input/expected-output pairs. Run them against prompt changes before deploying. Catch regressions before users do.

## When to Use

- Prompts that have been tuned over time
- Production prompts with known good behavior
- Before updating models or prompt templates
- When multiple people edit the same prompts

## Implementation

**Test case structure:**
```yaml
- name: "extract_date_standard"
  input: "Meeting scheduled for January 15, 2024"
  expected:
    date: "2024-01-15"
    
- name: "extract_date_relative"
  input: "Let's meet next Tuesday"
  expected:
    date: null  # Can't resolve without context
    error: "relative_date_unsupported"
```

**Test runner:**
```python
def run_prompt_tests(prompt_template, test_cases):
    results = []
    for case in test_cases:
        output = run_prompt(prompt_template, case.input)
        passed = matches_expected(output, case.expected)
        results.append(TestResult(case.name, passed, output))
    return results
```

## What to Test

- Happy path (the common case works)
- Edge cases (empty input, long input, special characters)
- Known failure modes (cases that broke before)
- Format compliance (output matches schema)

## Tips

- Start with cases from production bugs (they become regression tests)
- Include negative cases (things the prompt should refuse)
- Version test suites alongside prompts
- Run on model updates, not just prompt changes

## Anti-patterns

- Testing only happy path
- Exact string matching (brittle; use semantic comparison)
- No baseline (can't tell if change helped or hurt)
- Running tests only manually

## Related Patterns

- [Structured Output](/SHRINE/patterns/structured-output/): structured output is easier to test
- [Verification Loops](/SHRINE/patterns/verification-loops/): verification can be part of the test
