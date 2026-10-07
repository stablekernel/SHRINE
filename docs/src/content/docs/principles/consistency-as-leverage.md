---
title: "Consistency as Leverage"
description: "Pattern predictability reduces tokens more than prompt optimization."
proposal: "https://github.com/stablekernel/SHRINE/discussions/6"
last-reviewed: 2026-10-07
---

*The biggest efficiency lever is the codebase, not the prompt.*

## The Principle

- Predictable code beats a tuned prompt
- A tuned prompt over an inconsistent codebase still rediscovers conventions every task

## Why

- **Context cost**: three error-handling styles means reading all three
- **Correction loops**: unpredictable code produces plausible-but-wrong guesses
- **Verification cost**: reviewers diff against a known pattern cheaply
- Prompt optimization is linear; consistency compounds across every task and agent

## What It Looks Like

- One project structure, so file location follows from purpose
- Naming strict enough to guess an identifier before reading it
- Documented architecture, so "how do we do X" has one answer
- One error-handling idiom and one testing approach per repo

## Where a Convention Lives

- **Lint rule or hook**: when the convention is mechanically checkable
- **Standing instructions**: when it is a convention the agent must follow but no check enforces yet ([Memory & Context](/SHRINE/stack/memory/#standing-instructions))
- **Doc**: when it is rationale, the why behind a convention
- Promote from instructions to lint as soon as a check can enforce it

## Implemented By

- [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/): code generates the structure
- [Repository Context](/SHRINE/stack/repository-context/): indexed code makes conventions cheap to find
- [Skills & Prompts](/SHRINE/stack/skills/): write conventions down once
- [Memory & Context](/SHRINE/stack/memory/#standing-instructions): standing instructions load conventions every session

## Open Questions

- Brownfield default: freeze the dominant pattern, ratchet, or enforce only in new code?

Proposal: [Discussion #6](https://github.com/stablekernel/SHRINE/discussions/6)
