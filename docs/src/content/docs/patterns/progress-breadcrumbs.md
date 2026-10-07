---
title: "Progress Breadcrumbs"
description: "Record an agent's progress on a shared work board, not in the chat."
proposal: "https://github.com/stablekernel/SHRINE/pull/16"
last-reviewed: 2026-10-07
status: ratified
---

*If it only happened in the chat, it did not happen.*

## The Pattern

- One board item per plan step
- The card moves as the work moves: To Do, In Progress, Blocked, Done
- The agent adds a short comment per step: what is done, the evidence, what is next
- The board, not the transcript, is the record of the run

## What to Record

- **Start**: step picked up, plan link, what "done" means for this step
- **Decisions**: the choice made and one line of rationale
- **Checkpoint requests**: what needs a human, and what the agent does while it waits
- **Verification results**: command run, pass or fail, link to the run
- **Final outcome**: result, and cost per win (tokens plus human touches)

## On Abort

- Comment with the abort report: what failed, what was tried, the state left behind
- Move the card to Blocked, not Done and not back to To Do
- Leave the next action explicit, so a human or the next session can pick it up

## Board-Agnostic

- Any tracker the agent can write to works: issues, a project board, a ticket system
- Example: one GitHub issue per step, linked from a project board
- The pattern is the trail, not the tool

## When to Use

- Runs longer than one session
- Several agents or humans need status on the same work
- Work must survive a crash, a restart, or context compaction
- Checkpoints are asynchronous: the human answers hours later

## When Not to Use

- Short tasks that finish in one session
- Private scratch exploration nobody else needs to follow
- Boards nobody reads
- Trackers where each comment pages people (high notification cost)

## Worked Example

Plan: add rate limiting to a public API, four steps, four cards.

- **Card 1, Done**: "Middleware added. Evidence: `make test` green, commit a1b2c3. Next: config."
- **Card 2, Done**: "Limits read from config. Decision: per-key, not per-IP, because many callers share one NAT address. Evidence: commit d4e5f6."
- **Card 3, Blocked**: abort report below
- **Card 4, To Do**: load test, untouched

```
Step 3: return 429 with Retry-After
Result: aborted after 3 attempts
Evidence: integration run #412, same failure twice
Tried: header set in middleware; header set in handler
State: branch rate-limit, last green commit d4e5f6
Next: human decision, gateway strips Retry-After?
Open question: is the gateway config ours to change?
```

- A human reads the four cards in one pass
- No transcript needed to know what shipped, what broke, and what to decide

## Comment Template

```
Step: <plan step id and name>
Result: done | failed | blocked
Evidence: <test run link, commit, output line>
Next: <next action and owner>
Open question: <or "none">
```

## Anti-patterns

- Status that lives only in chat scrollback
- One giant comment at the end instead of one per step
- Breadcrumbs without evidence: "done" with no command, run, or commit
- Log spam: every tool call posted as a comment
- Secrets, credentials, or personal data in comments
- A trail that says Done while the branch is red
- The agent editing cards it does not own

## Related

- [Unattended Runs](/SHRINE/patterns/unattended-runs/): breadcrumbs are how a long run reports while nobody watches
- [Context Handoff](/SHRINE/patterns/context-handoff/): the handoff note can live on the board
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): checkpoint requests become card comments
- [Observability & Logging](/SHRINE/stack/observability/): traces are for machines; breadcrumbs are the human-readable trail
- [Tokens to Value](/SHRINE/principles/tokens-to-value/): record cost per win where people can see it
