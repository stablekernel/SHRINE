---
title: "Verification Loops"
description: "Generate, verify, iterate until correct."
---

*Trust but verify. Then fix what fails.*

## The Pattern

After generating output, run verification checks. If checks fail, feed failures back and regenerate. Repeat until verification passes or max iterations reached.

## When to Use

- Output has checkable correctness criteria
- First-attempt accuracy isn't reliable enough
- The cost of verification is lower than the cost of errors
- Automated checks exist (tests, linters, validators)

## Implementation

```
loop:
  output = generate(prompt)
  errors = verify(output)
  if no errors: return output
  if max_iterations: return failure
  prompt = prompt + "Fix these errors: " + errors
```

## Verification Types

- **Syntax**: Does it parse? Does it compile?
- **Tests**: Do provided tests pass?
- **Schema**: Does it match the expected structure?
- **Constraints**: Does it satisfy stated requirements?
- **Self-check**: Does the model agree it's correct?

## Tips

- Set max iterations to avoid infinite loops
- Make error messages actionable (not just "failed")
- Log iterations for debugging
- Consider whether iteration cost exceeds value

## Anti-patterns

- No iteration limit (runaway costs)
- Vague error messages (model can't fix what it doesn't understand)
- Verifying things that don't matter
- Not tracking iteration count (hidden cost)
