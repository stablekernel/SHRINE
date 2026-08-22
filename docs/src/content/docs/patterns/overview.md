---
title: "Patterns"
description: "Approaches and tactics for getting more value from your AI stack."
---

<!-- MAINTAINER: Keep entries in alphabetical order -->

Patterns are reusable approaches for structuring AI work. They're not tools themselves, but ways of combining tools to solve harder problems or achieve higher confidence.

## When to Reach for a Pattern

- The task is ambiguous or open-ended
- A single model call isn't reliable enough
- You need confidence beyond "it returned something"
- The work can be decomposed into parallel tracks

## Pattern Categories

### Verification Patterns
Getting confidence that output is correct.
- [Adversarial Review](/the-shrine/patterns/adversarial-review/)
- [Multi-Model Consensus](/the-shrine/patterns/multi-model-consensus/)

### Decomposition Patterns
Breaking work into parallelizable pieces.
- [Subagent Fanout](/the-shrine/patterns/subagent-fanout/)
- [Pipeline Orchestration](/the-shrine/patterns/pipeline-orchestration/)

### Quality Patterns
Improving output without changing the core approach.
- [Iterative Refinement](/the-shrine/patterns/iterative-refinement/)
- [Seed Planting](/the-shrine/patterns/seed-planting/)
