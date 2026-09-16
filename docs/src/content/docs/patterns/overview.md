---
title: "Patterns"
description: "Approaches humans apply when guiding agents or crafting skills."
---

<!-- MAINTAINER: Categories are ordered by workflow (ask, verify, orchestrate, evolve); keep entries in alphabetical order within each category -->

Patterns are reusable techniques for getting better results from AI. They're not tools themselves, but ways of structuring prompts, workflows, and interactions.

## When to Reach for a Pattern

- The task is ambiguous or open-ended
- A single prompt isn't reliable enough
- You need confidence beyond "it returned something"
- You're building a skill or workflow others will reuse

## Prompting Patterns

How to structure what you ask.

- [Chain of Thought](/SHRINE/patterns/chain-of-thought/): Force explicit reasoning steps
- [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/): Guide format with examples
- [Structured Output](/SHRINE/patterns/structured-output/): Constrain output to a schema

## Verification Patterns

How to gain confidence in output.

- [Adversarial Review](/SHRINE/patterns/adversarial-review/): Challenge output with an external skeptic
- [Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/): Compare independent attempts
- [Self-Critique](/SHRINE/patterns/self-critique/): Have the model evaluate its own output
- [Verification Loops](/SHRINE/patterns/verification-loops/): Generate, verify, iterate

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

- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): Feed improvements back to the system
- [Dogfooding](/SHRINE/patterns/dogfooding/): Validate by using your own output
- [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/): Detect when prompt changes break existing behavior
