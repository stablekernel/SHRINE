---
title: "Authority Cascade"
description: "Decisions follow a fixed precedence: Org > Client > Team > Role > Individual."
proposal: "https://github.com/stablekernel/SHRINE/discussions/5"
last-reviewed: 2026-10-07
status: ratified
---

*Solved problems stay solved.*

## The Principle

- Precedence is fixed: **Org > Client > Team > Role > Individual**
- Each layer sets defaults; any layer above overrides
- Personal preference applies only where nothing above has spoken
- The cascade resolves conflicts; it does not generate rules
- A layer with no opinion delegates downward by default

## Why

- Settled questions stop being re-litigated
- Onboarding becomes reading the cascade top-down, not archaeology
- Conventions live at a layer, not in someone's head, so staffing stays flexible
- Agents load inherited rules instead of rediscovering context each session

## The Layers

- **Organization**: holds for every engagement (security baseline, review discipline)
- **Client**: engagement requirements that override org defaults (stack, compliance, conventions)
- **Team**: conventions within org and client constraints (branch strategy, cadence)
- **Role**: expectations tied to a function (architect, engineer, reviewer)
- **Individual**: everything left unspecified (editor, local tooling, workflow)

## In Practice

- Altitude test: an org rule must hold for every engagement, or it moves down
- A team convention individuals routinely override gets deleted or promoted
- Encode each layer in agent-loadable files ([Skills & Prompts](/SHRINE/stack/skills/))
- Rule changes follow [Governance](/SHRINE/reference/governance/)

## Signal of Violation

- Settled questions reopened: the same convention is argued again in each review or engagement
- An org rule that fails the altitude test: client teams carry standing exceptions to it
- Conventions held in one person's head: agents rediscover them every session, and work stalls when that person rotates off
- Written rule and daily practice disagree: the team convention says one thing, merged code does another

## Open Questions

- Where does each rule record its owning layer, in a form agents can load?
- Who breaks the tie when a client requirement contradicts an org standard?

Proposal: [Discussion #5](https://github.com/stablekernel/SHRINE/discussions/5)
