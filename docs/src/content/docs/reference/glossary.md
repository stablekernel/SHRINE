---
title: "Glossary"
description: "Key terms and definitions."
---

<!-- MAINTAINER: Keep entries in alphabetical order (ignore a leading "The") -->

## Checkpoint Gate

A mechanical block before an irreversible or outward-facing action that parks a one-step decision for a human. See [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/).

## Compaction

Summarizing an agent's context in place to free space. Keeps continuity but can drop constraints. See [Context Handoff](/SHRINE/patterns/context-handoff/).

## Context Handoff

A written record of goal, state, evidence, decisions and next step that lets a fresh session resume a run. See [Context Handoff](/SHRINE/patterns/context-handoff/).

## Context Window

The amount of text a model can process in a single call. Exceeding it causes truncation or failure.

## Correction Diagnosis

Tracing a repeated correction to the input that caused it, then fixing that input. See [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/).

## Delegation Fit

The per-task choice to delegate, pair, or write by hand, made before prompting. See [Delegation Fit](/SHRINE/patterns/delegation-fit/).

## Harness

The interface to the models: the CLI, IDE extension, or application that orchestrates prompts, tools, and context. See [Harness Selection](/SHRINE/stack/harness/).

## Keepers

Repository Maintainers or higher. They endorse proposals, resolve objections, and ratify additions to SHRINE. See [Governance](/SHRINE/reference/governance/).

## Orchestration

Coordinating multiple models, agents, or pipeline stages so each handles the part of a task it is best suited for.

## Progress Breadcrumbs

Short, evidence-linked progress notes an agent writes to a shared work board. See [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/).

## Quorum

A majority of current keepers. Required to override a standing objection during ratification.

## Ratification

The final step of the proposal lifecycle: after two keeper endorsements and the objection window, the draft PR merges and the content becomes part of SHRINE. See [Governance](/SHRINE/reference/governance/).

## Repository Context

Indexed knowledge of a codebase (symbols, references, code graph) exposed to agents. Distinct from memory. See [Repository Context](/SHRINE/stack/repository-context/).

## Reviewable Output

Agent output shaped to be cheap to review: small diffs, attached evidence, and a review note. See [Reviewable Output](/SHRINE/patterns/reviewable-output/).

## Routing

Selecting which model handles which task based on complexity, cost, and capability requirements.

## Scaffolding

Workarounds, wrappers, and patterns built to compensate for model limitations. May become obsolete as models improve. Distinct from [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/), which is repeatable structure for token efficiency.

## SHRINE

Stable-Kernel Hosted Reasoning & Inference Network Environment. The org's open forum and governance site for how we build with AI.

## Skills

Packaged, reusable instructions for accomplishing specific tasks efficiently.

## Spec

A written agreement before execution: problem, constraints, acceptance criteria with checks, out of scope, checkpoints, abort criteria and stop condition. See [Spec, Then Build](/SHRINE/patterns/spec-then-build/).

## Stack

An abstract capability slot: what the capability must do, how to select for it, and its anti-patterns. Not a product list. See [FAQ](/SHRINE/faq/).

## Standing Instructions

A short per-repo instruction file the harness loads every session: commands, idioms, and conventions the agent cannot cheaply derive from the code. See [Memory & Context](/SHRINE/stack/memory/#standing-instructions).

## Step-Level Routing

Choosing model tier and reasoning effort for each step inside an agent trajectory. See [Step-Level Routing](/SHRINE/patterns/step-level-routing/).

## Subagent

An agent spawned by a primary agent to handle a scoped task, often in parallel with others. Keeps the main context lean and the work isolated.

## TTV (Tokens to Value)

Value per win, where a win costs tokens plus human attention (engineer minutes steering, reviewing, babysitting). The north star metric: drive cost per win down, not raw token usage. See [TTV](/SHRINE/principles/tokens-to-value/).

## Unattended Run

An agent run that works for hours without a human watching each step, bounded by a time limit, abort criteria and a stop condition. See [Unattended Runs](/SHRINE/patterns/unattended-runs/).
