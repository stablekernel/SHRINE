---
title: "Patterns"
description: "Approaches humans apply when guiding agents or crafting skills."
---

<!-- MAINTAINER: Keep categories and entries in alphabetical order within each category -->

Patterns are reusable techniques for getting better results from AI. They're not tools themselves, but ways of structuring prompts, workflows, and interactions.

## When to Reach for a Pattern

- The task is ambiguous or open-ended
- A single prompt isn't reliable enough
- You need confidence beyond "it returned something"
- You're building a skill or workflow others will reuse

## Prompting Patterns

How to structure what you ask.

- [Chain of Thought](/the-shrine/patterns/chain-of-thought/): Force explicit reasoning steps
- [Few-Shot Examples](/the-shrine/patterns/few-shot-examples/): Guide format with examples
- [Structured Output](/the-shrine/patterns/structured-output/): Constrain to a schema

## Verification Patterns

How to gain confidence in output.

- [Adversarial Review](/the-shrine/patterns/adversarial-review/): External skeptic challenges output
- [Multi-Model Consensus](/the-shrine/patterns/multi-model-consensus/): Compare independent attempts
- [Self-Critique](/the-shrine/patterns/self-critique/): Model evaluates its own output
- [Verification Loops](/the-shrine/patterns/verification-loops/): Generate, verify, iterate

## Orchestration Patterns

How to structure complex work.

- [Iterative Refinement](/the-shrine/patterns/iterative-refinement/): Successive improvement passes
- [Pipeline Orchestration](/the-shrine/patterns/pipeline-orchestration/): Sequential stages
- [RAG](/the-shrine/patterns/rag/): Ground in retrieved context
- [Subagent Fanout](/the-shrine/patterns/subagent-fanout/): Parallel workers

## Evolution Patterns

How systems improve through use.

- [Discovery Propagation](/the-shrine/patterns/discovery-propagation/): Feed improvements back to the system
- [Dogfooding](/the-shrine/patterns/dogfooding/): Validate by using your own output
