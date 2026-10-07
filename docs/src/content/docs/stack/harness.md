---
title: "Harness Selection"
description: "Choosing and configuring your AI development environment."
status: draft
---

*The harness is where the work happens. Choose deliberately.*

## What is a Harness?

The harness is your interface to the models: the CLI, IDE extension, or application that orchestrates prompts, tools, and context. It shapes how you work.

## Key Selection Criteria

### Tool Access
- What tools can the harness invoke?
- Can it read/write files, run commands, access APIs?
- How are permissions managed?

### Context Management
- How does it handle long conversations?
- Does it support memory across sessions?
- How does it manage context window limits?

### Model Flexibility
- Which models are available?
- Can you switch models mid-task?
- How is routing handled?

### Extensibility
- Can you add custom skills or commands?
- How are plugins/extensions managed?
- What's the learning curve?

## Current Options

- Evaluated harnesses live in the [Current Stack Roster](/SHRINE/reference/current-stack/#harness)

## Evaluation Questions

1. Does it support the patterns we use? (fanout, pipelines, adversarial)
2. How does it handle failures and retries?
3. What's the context overhead per interaction?
4. Can it evolve with our stack, or is it a point-in-time choice?

## Anti-patterns

- Choosing based on hype rather than fit
- Switching harnesses without migrating skills/patterns
- Over-customizing to the point of lock-in
- Under-investing in harness proficiency
