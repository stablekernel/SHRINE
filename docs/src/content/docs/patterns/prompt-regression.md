---
title: "Prompt Regression Testing"
description: "Detect when prompt changes break existing behavior."
---

*Prompts are code. Test them like code.*

## The Pattern

Maintain a suite of inputs with expected outcomes. Run it against every prompt or model change before deploying. Compare to a recorded baseline.

## When to Use

- Prompts that have been tuned over time
- Production prompts with known good behavior
- Before updating models or prompt templates ([Deliberate Currency](/SHRINE/principles/deliberate-currency/))
- When multiple people edit the same prompts

## When Not to Use

- Throwaway prompts that will not run again
- Exploration and brainstorming paths marked exempt from reproducibility ([Reproducibility](/SHRINE/principles/reproducibility/))
- Before the expected behavior is settled: tests would lock in a guess

## Matching Strategy

Pick the match type per field, not per suite.

- **Exact match** on structured fields: dates, enums, IDs, booleans, error codes
- **Semantic or rubric match** on prose: a grader checks required points, not wording
- **N-run thresholds** for nondeterminism: run each case N times, pass at a set rate (for example 9 of 10)
- Exact match on free prose is the brittle case; exact match on structured fields is correct

## Implementation

**Test case structure:**
```yaml
- name: "extract_date_standard"
  input: "Meeting scheduled for January 15, 2024"
  expected:
    date: "2024-01-15"          # exact
  runs: 5
  pass_rate: 1.0

- name: "extract_date_relative"
  input: "Let's meet next Tuesday"
  expected:
    date: null                  # exact
    error: "relative_date_unsupported"

- name: "summarize_incident"
  input: "fixtures/incident-142.txt"
  rubric:                       # graded, not string-matched
    - "names the failed service"
    - "states customer impact"
    - "does not speculate on root cause"
  runs: 10
  pass_rate: 0.9
```

**Test runner:**
```python
def run_case(prompt, model, case):
    passes = 0
    for _ in range(case.runs):
        output = run_prompt(prompt, model, case.input)
        if case.expected and exact_match(output, case.expected):
            passes += 1
        elif case.rubric and rubric_grade(output, case.rubric):
            passes += 1
    return passes / case.runs >= case.pass_rate
```

## Worked Example

A team moves an extraction prompt to a newer model version.

1. Baseline: current model passes 48 of 50 cases; results stored with prompt and model version
2. Candidate: same suite, same prompt, new model
3. Result: 47 of 50; the same 2 known failures plus 1 new failure
4. New failure: `extract_amount_with_comma` returns `1.2` for `"$1,200.00"` on 4 of 10 runs; threshold is 10 of 10
5. Decision: block the upgrade; add a format example to the prompt; rerun
6. Rerun: 48 of 50 passing, no new failures; new baseline recorded; upgrade ships

What made it catchable:
- A stored baseline to diff against
- An exact-match structured field
- N runs exposing an intermittent failure a single run could miss

## What to Test

- Happy path
- Edge cases (empty input, long input, special characters)
- Known failure modes (cases that broke before)
- Format compliance (output matches schema)
- Negative cases (things the prompt should refuse)

## Tips

- Turn production bugs into regression cases
- Version suites and baselines alongside prompts
- Run on model updates, not just prompt changes
- Track suite results over time ([Evaluation](/SHRINE/stack/evaluation/))

## Anti-patterns

- Testing only the happy path
- Exact string matching on free prose
- Single runs on nondeterministic output
- No baseline (cannot tell if a change helped or hurt)
- Running tests only manually

## Related Patterns

- [Structured Output](/SHRINE/patterns/structured-output/): structured fields enable exact-match tests
- [Verification Loops](/SHRINE/patterns/verification-loops/): verification checks can double as test assertions
