---
title: "Patterns"
description: "Approaches humans apply when guiding agents or crafting skills."
status: ratified
---

<!-- MAINTAINER: Categories are ordered by workflow (ask, verify, plan, orchestrate, evolve); keep entries in alphabetical order within each category -->

Patterns are reusable techniques for getting better results from AI. They're not tools themselves, but ways of structuring prompts, workflows, and interactions.

- Status: patterns are **Ratified**; change one through a Discussion ([Page Status](/SHRINE/reference/governance/#page-status))

## When to Reach for a Pattern

- The task is ambiguous or open-ended
- A single prompt isn't reliable enough
- You need confidence beyond "it returned something"
- You're building a skill or workflow others will reuse
- You correct the same kind of output repeatedly ([Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/))

## If You See X, Read Y

| Symptom | Read |
|---|---|
| Fixing output takes longer than writing it | [Delegation Fit](/SHRINE/patterns/delegation-fit/) |
| Same correction, again and again | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/) |
| Wrong format or style | [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/), [Structured Output](/SHRINE/patterns/structured-output/) |
| Plausible code that does not run | [Verification Loops](/SHRINE/patterns/verification-loops/) |
| Diffs too large to review | [Reviewable Output](/SHRINE/patterns/reviewable-output/) |
| Solved the wrong problem | [Spec, Then Build](/SHRINE/patterns/spec-then-build/) |
| Long run drifts or loses the thread | [Context Handoff](/SHRINE/patterns/context-handoff/), [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/) |
| Agent took an irreversible action unasked | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/) |
| Shallow answers on hard steps | [Chain of Thought](/SHRINE/patterns/chain-of-thought/), [Step-Level Routing](/SHRINE/patterns/step-level-routing/) |
| Confident answers about your own data that are wrong | [RAG](/SHRINE/patterns/rag/) |
| A prompt change broke something that worked | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/) |

## Prompting Patterns

How to structure what you ask.

- [Chain of Thought](/SHRINE/patterns/chain-of-thought/): Get reasoning before conclusions
- [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/): Guide format with examples
- [Structured Output](/SHRINE/patterns/structured-output/): Constrain output to a schema

## Verification Patterns

How to gain confidence in output.

- [Adversarial Review](/SHRINE/patterns/adversarial-review/): Challenge output with an external skeptic
- [Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/): Compare independent attempts
- [Reviewable Output](/SHRINE/patterns/reviewable-output/): Shape output so review is against intent, not from scratch
- [Self-Critique](/SHRINE/patterns/self-critique/): Have the model evaluate its own output
- [Verification Loops](/SHRINE/patterns/verification-loops/): Generate, verify, iterate

## Planning Patterns

How to set up and carry agent work

- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): Block irreversible actions until a human clears a one-step decision
- [Context Handoff](/SHRINE/patterns/context-handoff/): Carry a run across compactions and sessions with a written handoff
- [Delegation Fit](/SHRINE/patterns/delegation-fit/): Decide per task whether to delegate, pair, or write by hand
- [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/): Record progress on a shared work board, not in the chat
- [Spec, Then Build](/SHRINE/patterns/spec-then-build/): Agree a written spec and reviewed plan before execution
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): Launch an agent for hours with a stop condition and abort criteria

## Orchestration Patterns

How to structure complex work.

- [Iterative Refinement](/SHRINE/patterns/iterative-refinement/): Improve output through successive passes
- [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/): Build repeatable structure once, fill with context each time
- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): Chain sequential stages
- [RAG](/SHRINE/patterns/rag/): Ground responses in retrieved context
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): Route each step to a model tier and reasoning effort
- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): Fan work out to parallel agents
- [Task Routing](/SHRINE/patterns/task-routing/): Match each task to the right model for cost and capability

## Evolution Patterns

How systems improve through use.

- [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/): Trace each correction to the input that caused it
- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): Feed improvements back to the system
- [Dogfooding](/SHRINE/patterns/dogfooding/): Validate by using your own output
- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): Detect when prompt changes break existing behavior
