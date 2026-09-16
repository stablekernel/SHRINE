---
title: "Glossary"
description: "Key terms and definitions."
---

<!-- MAINTAINER: Keep entries in alphabetical order (ignore a leading "The") -->

## Context Window

The amount of text a model can process in a single call. Exceeding it causes truncation or failure.

## Harness

The interface to the models: the CLI, IDE extension, or application that orchestrates prompts, tools, and context. See [Harness Selection](/SHRINE/stack/harness/).

## Keepers

Repository Maintainers or higher. They endorse proposals, resolve objections, and ratify additions to SHRINE. See [Governance](/SHRINE/reference/governance/).

## Orchestration

Coordinating multiple models, agents, or pipeline stages so each handles the part of a task it is best suited for.

## Quorum

A majority of current keepers. Required to override a standing objection during ratification.

## Ratification

The final step of the proposal lifecycle: after two keeper endorsements and the objection window, the draft PR merges and the content becomes part of SHRINE. See [Governance](/SHRINE/reference/governance/).

## Repository Context

Indexed knowledge of a codebase (symbols, references, code graph) exposed to agents. Distinct from memory. See [Repository Context](/SHRINE/stack/repository-context/).

## Routing

Selecting which model handles which task based on complexity, cost, and capability requirements.

## Scaffolding

Workarounds, wrappers, and patterns built to compensate for model limitations. May become obsolete as models improve.

## SHRINE

Stable-Kernel Hosted Reasoning & Inference Network Environment. The org's open forum and governance site for how we build with AI.

## Skills

Packaged, reusable instructions for accomplishing specific tasks efficiently.

## Step-Level Routing

Choosing model tier and reasoning effort for each step inside an agent trajectory. See [Step-Level Routing](/SHRINE/patterns/step-level-routing/).

## Subagent

An agent spawned by a primary agent to handle a scoped task, often in parallel with others. Keeps the main context lean and the work isolated.

## TTV (Tokens to Value)

How much model consumption it takes to produce a successful, useful outcome. The north star metric: maximum value per token, not minimum token usage. See [TTV](/SHRINE/principles/tokens-to-value/).
