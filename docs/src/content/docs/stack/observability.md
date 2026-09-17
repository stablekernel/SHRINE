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
- Model used, with exact model version
- Parameters (temperature, reasoning effort, max tokens) and seed ([Reproducibility](/SHRINE/principles/reproducibility/))
- Prompt or skill version
- Outcome ID linking the call to a ticket, PR, or eval run ([TTV](/SHRINE/principles/tokens-to-value/))
- Token counts (input, output, cached)
- Latency
- Success/failure status and finish reason

### Per-Session
- Conversation flow
- Tool calls and results
- Context accumulation
- Total cost
- Human interventions and active minutes
- Retries and their triggers
- Stop reason (completed, budget hit, error, human stop)

### Aggregate
- Success rates over time
- Token spend by task type
- Tokens per win and human attention per win ([Cost Management](/SHRINE/stack/cost-management/))
- Waste bucket: tokens from failed or abandoned runs
- Error patterns
- Latency distributions

## Agent Runs

- **Trace tree**: one root span per run; child spans per model call and per tool call
- **On each span**: token counts, model, finish reason, tool name, and status
- **Standard attributes**: target the vendor-neutral [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai), which define agent, model-call, and tool-execution spans
- The conventions are still in development; pin the version you emit
- **Human-readable trail**: keep a short progress log separate from traces, for people resuming the work ([Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/))
- **Read transcripts regularly**: they show whether a failure is a real agent mistake or a harness or grader problem ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))
- One team tuned its evaluator by reading its logs and fixing where its judgment diverged from a human's ([Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps))

## Legible to the Agent

- Expose logs, metrics, and traces to the agent, not only to dashboards
- An agent that can query its own run's telemetry can verify and debug its own change
- One team gave each worktree an ephemeral observability stack the agent queries directly, making goals like "startup under 800ms" checkable ([OpenAI](https://openai.com/index/harness-engineering/))
- Scope agent access to the telemetry of its own run and environment

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
- Logging tokens with no outcome ID (cost you cannot tie to a win)
- Traces nobody reads
