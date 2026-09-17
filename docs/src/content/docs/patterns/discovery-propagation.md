---
title: "Discovery Propagation"
description: "When agents find better paths, propose improvements back to the system through review."
---

*The system should learn from what it discovers, with a human in the path.*

## The Pattern

- An agent finds a better approach, a missing capability, or a reusable lesson
- It proposes the improvement for future use
- A reviewer approves, edits, or rejects the proposal
- Only approved changes are encoded and reach other sessions
- Propagation always passes review; nothing spreads on its own

## When to Use

- The same friction shows up more than once
- A lesson applies beyond the current task
- A convention can be written down or enforced
- There is a place to receive and review proposals

## When Not to Use

- **One-off quirks**: a flaky mirror today is not a rule
- **Unverified single observations**: wait until the lesson shows up twice
- **Facts that drift**: versions, line numbers, current owners; re-derive them instead ([Memory](/SHRINE/stack/memory/))
- **Active re-evaluation**: an area under review should not churn from new proposals mid-review

## What Gets Propagated

- **Tool improvements**: a skill that could be faster, a missing tool capability, a prompt that worked better
- **Environment insights**: a convention worth standardizing, a failure mode worth guarding
- **Knowledge**: methods and corrections future tasks will need

## Where Lessons Land

| Lesson type | Destination |
|------|------|
| Method or correction | Memory entry ([Memory](/SHRINE/stack/memory/)) |
| Repeatable workflow | Skill ([Skills](/SHRINE/stack/skills/)) |
| Enforceable convention | Rule, lint, or hook |
| Repeatable structure | Scaffold ([Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/)) |

- Prefer the most enforceable destination; a lint beats a paragraph
- Scope to the narrowest layer that needs it ([Authority Cascade](/SHRINE/principles/authority-cascade/))

## Implementation

1. **Detect**: agent notices a repeat or a gap
2. **Propose**: surface the finding with evidence; never mutate silently
3. **Review**: a human or a defined process approves, edits, or rejects
4. **Encode**: write the approved change to its destination
5. **Scope**: publish at the right layer (project, team, org)

## Worked Example

1. An agent run fails lint on an import-order rule; it fixes the file by hand
2. A later run hits the same misconfiguration in the same repo
3. On the second hit, the agent writes a proposal:
   - Observation: two runs hit the same import-order failure
   - Evidence: both run logs, the lint output
   - Proposal: add an import-order step to the team's "prepare commit" skill
4. A reviewer approves, trims the step to one command, and scopes it to the team layer
5. The skill change is merged with a note linking the two runs
6. The next run loads the updated skill and passes lint first try

## Guardrails

- Propose, never silently adopt; humans approve changes
- Scope appropriately; not every insight is org-wide
- Filter for repeats; avoid churn
- Track provenance: which runs, which evidence, who approved
- Retire what stops earning its keep ([Deliberate Currency](/SHRINE/principles/deliberate-currency/))

## Goals

- Friction gets reported, not endured
- Agents contribute proposals to their own tooling
- Every adopted change has a reviewer and a source
- The system improves through use and review

## Anti-patterns

- Insights that die with the session
- Silent mutations without review
- Over-propagation: noise drowns signal
- No mechanism to receive proposals
- Proposals with no evidence attached

## Related

- [Deliberate Currency](/SHRINE/principles/deliberate-currency/): when to re-examine what was adopted
- [Authority Cascade](/SHRINE/principles/authority-cascade/): which layer a lesson belongs to
- [Skills](/SHRINE/stack/skills/): the home for repeatable workflows
- [Memory](/SHRINE/stack/memory/): the home for methods and corrections
- [Governance](/SHRINE/reference/governance/): how proposals get approved
