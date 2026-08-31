---
title: "Agent Architecture & Orchestration"
description: "How we decompose, delegate, validate, and recover."
---

*One agent doing everything is a single point of failure with a full context window.*

## What This Covers

How multi-agent work gets structured: decomposing a goal into agent-sized tasks, choosing an orchestration topology, validating outputs at the seams, and recovering when an agent fails mid-flight.

## Key Principles

- Decompose work into focused, single-purpose agents
- Validate outputs before acting on them
- Build recovery into the architecture, not as an afterthought
- Failures are the most expensive tokens; design to minimize them

## Orchestration Topologies

- **Fanout**: independent subtasks run in parallel, results merged ([Subagent Fanout](/SHRINE/patterns/subagent-fanout/))
- **Pipeline**: staged handoffs where each stage's output is the next stage's input ([Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/))
- **Adversarial**: one agent produces, another attacks the result ([Adversarial Review](/SHRINE/patterns/adversarial-review/))
- **Consensus**: several models answer independently, a judge reconciles ([Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/))

## Key Considerations

### Task Boundaries
- Can the subtask be briefed in one message, with no mid-flight clarification?
- Does it share mutable state (a branch, a file) with a concurrent agent? Disjoint scopes or serialize.
- Is the acceptance criterion checkable by the orchestrator without redoing the work?

### Trust and Validation
- An agent's report is a claim, not evidence: verify the artifact, not the summary
- Fabrication happens; validation at the seam is what keeps it out of deliverables
- Use [Verification Loops](/SHRINE/patterns/verification-loops/) at every handoff that feeds a downstream action

### Recovery
- What happens when an agent times out, drifts from its brief, or returns garbage?
- Prefer retriable, idempotent subtasks; design so a failed agent can be relaunched cold
- Keep the orchestrator lean: coordination and decisions, not implementation

## Anti-patterns

- One mega-agent with an ever-growing prompt instead of decomposition
- Trusting subagent reports without inspecting outputs
- Parallel agents sharing a branch or file and merging by hope
- Orchestrator doing the work itself, burning the coordination context
