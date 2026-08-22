---
title: "Observability & Logging"
description: "Tracing, debugging, and monitoring your AI stack."
---

*You can't fix what you can't see.*

## Why Observability Matters

- Debug failures after the fact
- Understand what the model actually did
- Trace costs to specific operations
- Detect drift and degradation

## What to Capture

### Per-Request
- Input prompt (or hash if sensitive)
- Output response
- Model used
- Token counts (input, output)
- Latency
- Success/failure status

### Per-Session
- Conversation flow
- Tool calls and results
- Context accumulation
- Total cost

### Aggregate
- Success rates over time
- Token spend by task type
- Error patterns
- Latency distributions

## Tools

*Document your org's observability stack here.*

| Tool | Purpose |
|------|---------|
| Langfuse | Tracing, prompt management |
| Datadog | Metrics, APM |
| Custom logging | Domain-specific needs |

## Privacy Considerations

- PII in prompts/responses
- Retention policies
- Access controls
- Anonymization strategies

## Anti-patterns

- Logging everything (cost, privacy, noise)
- Logging nothing (flying blind)
- No correlation IDs (can't trace across services)
- Ignoring the logs you have
