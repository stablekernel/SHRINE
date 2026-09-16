---
title: "Consistency as Leverage"
description: "Pattern predictability reduces tokens more than prompt optimization."
proposal: "https://github.com/stablekernel/SHRINE/discussions/6"
last-reviewed: 2026-09-16
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

## Implemented By

- [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/): code generates the structure
- [Repository Context](/SHRINE/stack/repository-context/): indexed code makes conventions cheap to find
- [Skills & Prompts](/SHRINE/stack/skills/): write conventions down once

## Open Questions

- Which conventions get a lint rule, a doc, or an agent instruction file?
- Brownfield default: freeze the dominant pattern, ratchet, or enforce only in new code?

Proposal: [Discussion #6](https://github.com/stablekernel/SHRINE/discussions/6)
