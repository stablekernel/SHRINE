---
title: "Checkpoint Gates"
description: "Stop an agent before irreversible actions and hand the human a decision that clears in one step."
---

*Gate the action, not the agent.*

## The Pattern

- Classify every action the agent can take:
  - **Reversible**: local edits, test runs, scratch branches
  - **Irreversible**: merges, deploys, migrations, deletes
  - **Outward-facing**: external messages, published content, spend
- Gate irreversible and outward-facing actions mechanically
- At a gate, the agent parks the decision and continues independent work
- Implements [Human in the Loop](/SHRINE/principles/human-in-the-loop/) for agents no one is watching

## Enforce, Don't Exhort

- A prompt saying "ask before deploying" is a request the model can miss
- A permission rule or pre-action hook blocks the call whatever the model decides
- Example: Claude Code [`PreToolUse` hooks](https://code.claude.com/docs/en/hooks) run before a tool call and can deny it
- The gate lives in the harness or [tool layer](/SHRINE/stack/tool-integration/), not in the prompt
- If the gate itself errors, block: a crashed gate must not approve an irreversible action
- Convenience hooks (formatting, argument rewrites) may let the call through on error; gates may not
- Only the human can bypass a gate; a gate the agent can disable is not a gate

## Checkpoint List

- Written before launch, in the spec ([Spec, Then Build](/SHRINE/patterns/spec-then-build/))
- **By stakes**: hard to reverse, external, costly
- **By confidence**: novel situation, conflicting signals
- **By policy**: compliance or audit requirements

## Decision Card

- **Action**: exactly what will run
- **Why now**: what depends on it
- **Evidence**: test output, diff, dry run
- **Recommendation**: approve or reject, with the reason
- **Reversibility**: rollback path and its cost
- **Response**: approve or reject in one step
- Batch low-risk cards into one review

## When to Use

- Pushes, merges, deploys, migrations
- External messages and spend
- [Unattended runs](/SHRINE/patterns/unattended-runs/)

## When Not to Use

- Reversible local edits already covered by [Verification Loops](/SHRINE/patterns/verification-loops/)
- Sandboxed throwaway environments
- Gates so frequent that approval becomes a rubber stamp

## Worked Example

- Hour 2 of an unattended run; the next milestone needs a schema migration
- Agent calls the migration command; the pre-action rule blocks it
- Agent files a card on the work board:
  - **Action**: add nullable `refund_reason` column to `orders`
  - **Why now**: milestones 4 and 5 read the column
  - **Evidence**: migration passes on a local copy; dry-run SQL attached
  - **Recommendation**: approve; additive and nullable, no table rewrite expected
  - **Reversibility**: down migration drops the column; no data lost before use
- Agent continues milestone 3, which does not need the column
- Human reads the board at the next agreed check and approves in one step
- Agent runs the migration and resumes milestone 4

## Tuning Signals

- **Too wide**: near-100% approval, long streaks of approvals with no edits
- **Too slow**: cards wait longer than the work they block
- **Too narrow**: reverts or incidents after actions that passed ungated
- Review gate stats against [Tokens to Value](/SHRINE/principles/tokens-to-value/): attention spent per win

## Anti-patterns

- Approval requested by prompt text only
- "Yes to all" fatigue
- A card with no recommendation
- Blocking the whole run on one decision

## Related

- [Human in the Loop](/SHRINE/principles/human-in-the-loop/): which decisions need a human
- [Tokens to Value](/SHRINE/principles/tokens-to-value/): human attention is a cost
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): where gates matter most
- [Adversarial Review](/SHRINE/patterns/adversarial-review/): machine review before the card
- [Tool Integration](/SHRINE/stack/tool-integration/): where enforcement lives
