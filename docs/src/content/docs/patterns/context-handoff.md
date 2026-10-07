---
title: "Context Handoff"
description: "Carry a run across compactions and sessions with a written handoff, not a transcript."
proposal: "https://github.com/stablekernel/SHRINE/pull/16"
last-reviewed: 2026-10-07
status: ratified
---

*Every session starts cold. Leave the next one a clean desk.*

## The Pattern

- At a phase boundary, or before compaction, stop in a mergeable state
- Commit the work
- Write the handoff
- The next session starts fresh and reads the handoff first

## Handoff Fields

- **Goal**: one line
- **Spec or plan**: link
- **Done**: each item with evidence (commit, test run)
- **In progress**: what is partly built and where
- **Known broken**: failing tests, open bugs
- **Decisions**: what was chosen and why
- **Open questions**: what needs a human
- **Next step**: the single next action
- **Verify**: commands to confirm the state

## Where It Lives

- A file in the repo, or the work board ([Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/))
- Never only in chat

## Compaction vs. Reset

- **Compaction**: summarizes earlier conversation in place; the same agent continues on a shorter history
- **Reset**: clears the context and starts a new agent from a structured handoff
- Compaction keeps continuity but gives no clean slate; a reset gives a clean slate but depends on the handoff holding enough state ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps))
- Compaction alone can leave the next session with a half-built, undocumented feature ([Anthropic, long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents))

## Trigger Points

- End of a plan phase
- Context nearing its limit
- Before switching model or agent
- End of the working day
- After two corrections on the same issue: start fresh with a better prompt ([Session Rule](/SHRINE/patterns/correction-diagnosis/#session-rule); [Claude Code best practices](https://code.claude.com/docs/en/best-practices))

## Get-Bearings Routine

- Read the handoff and recent commits
- Pick the highest-priority unfinished item
- Run a smoke test before new work, so inherited breakage is fixed first
- Source: the same routine in [Anthropic, long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

## Steer Compaction

- State what must survive a summary
- Example instruction: preserve the full list of modified files and any test commands ([Claude Code best practices](https://code.claude.com/docs/en/best-practices))

## Why It Matters

- Models use information in the middle of long contexts less reliably than at the start or end ([Lost in the Middle](https://arxiv.org/abs/2307.03172))
- One harness report saw some models wrap up work early as they neared their perceived context limit ([Anthropic, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)); do not assume every model does this

## When to Use

- Runs longer than one context window
- Switching agent or model mid-run
- A human takes over from an agent, or the reverse
- Several agents take turns on one body of work

## When Not to Use

- Tasks that fit in one session
- Breadcrumbs on the board already hold the full state
- Exploratory threads where the reasoning trail matters more than the state

## Worked Example

Migrating a service from one ORM to another. Context reaches about 70%.

```
Goal: replace ORM in orders-service
Plan: docs/plans/orm-migration.md
Done: models ported (commit 3f1a), unit tests green (run #88)
In progress: repository layer, 4 of 9 files
Known broken: none
Decisions: keep soft-delete column; reporting job reads it
Open questions: none
Next: port OrderRepository.findByCustomer
Verify: make test && make migrate-check
```

- The session resets; the new session reads the note, runs `make test`, then continues at `findByCustomer`
- Without the note: a summary can keep "porting repositories" but drop "keep soft-delete column"
- The next session could then remove the column and break reporting

## Anti-patterns

- Automatic summary as the only memory
- Half-implemented feature with no note
- A handoff without evidence links
- Pasting the transcript as the handoff
- Letting the agent rewrite acceptance tests in the progress file

## Related

- [Memory & Context Management](/SHRINE/stack/memory/): the context window this pattern protects
- [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/): the durable trail the handoff can point to
- [Spec Then Build](/SHRINE/patterns/spec-then-build/): the spec is the stable goal every handoff links
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): switching models has a context transfer cost
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): long runs that cross context resets
