---
title: "Graceful Degradation"
description: "Define fallback behavior when LLM calls fail."
---

*Plan for failure before it happens.*

## The Pattern

Design systems that continue functioning when LLM calls fail, timeout, or return unusable output. Define explicit fallback behavior for each failure mode.

## When to Use

- Production systems that must stay up
- User-facing flows where failure is visible
- Pipelines where one stage's failure affects downstream
- Any system where "sorry, AI is broken" is not acceptable

## Failure Modes

| Mode | Cause | Typical Fallback |
|------|-------|------------------|
| Timeout | Network, overload | Retry with backoff, then cached/default |
| Rate limit | Quota exhaustion | Queue, route to alternate model |
| Parse failure | Bad output format | Retry with stricter prompt, then default |
| Content filter | Safety trigger | Log, return safe default |
| Hallucination | Confident wrong answer | Verification layer catches it |

## Implementation

```python
def call_with_fallback(prompt, primary="sonnet", fallback="haiku"):
    try:
        result = call_model(primary, prompt)
        if not validate(result):
            raise ValueError("Invalid output")
        return result
    except (Timeout, RateLimit) as e:
        log.warn(f"Primary failed: {e}, trying fallback")
        return call_model(fallback, prompt)
    except Exception as e:
        log.error(f"All models failed: {e}")
        return SAFE_DEFAULT
```

## Tips

- Define SAFE_DEFAULT for every call site
- Log failures with enough context to debug later
- Measure fallback rate; high rate means primary is misconfigured
- Test fallback paths explicitly (chaos engineering)

## Anti-patterns

- Silent failures (no logging, no visibility)
- Infinite retry loops
- Fallback to a model that will hit the same failure
- Returning partial/corrupt data instead of failing cleanly

## Related Patterns

- [Task Routing](/SHRINE/patterns/task-routing/): fallback often means routing to a different model
- [Verification Loops](/SHRINE/patterns/verification-loops/): verification catches some failures before they propagate
