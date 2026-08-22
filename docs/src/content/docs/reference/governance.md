---
title: "Governance"
description: "How principles, patterns, and practices are proposed, refined, and ratified."
---

## Keepers

Keepers guide what becomes official. They surface direction and hold space for discussion.

## What Can Be Proposed

All content in SHRINE follows the same lifecycle:

- **Principles**: Behavioral standards the org commits to
- **Patterns**: Reusable techniques for working with AI
- **Stack choices**: Tool, model, or integration recommendations
- **Governance changes**: Amendments to this process

## Before You Propose

Ask yourself:

- What's the cost of keeping this current as tools and practices change?
- What's the impact of accepting it?
- Is this already covered elsewhere?
- Can I demonstrate this with a real example?
- Would I follow this myself?
- Does this scale across teams and clients?
- Is this the right altitude? (principle vs pattern vs stack choice)

## Proposal Lifecycle

### 1. Propose

- Open a Discussion in the "Proposals" category
- Use this structure:

```
## The Proposal
One sentence. What are you proposing?

## Why This Matters
What goes wrong without it? Cite real examples if possible.

## Open Questions
What needs refinement before this solidifies?

## Documentation PR
Link to draft PR (added once refined)
```

### 2. Refine

- The community discusses
- The proposer updates the description as consensus emerges
- Open questions get resolved or split into separate proposals

### 3. Draft PR

- Once refined, the proposer opens a draft PR with the documentation update
- The PR adds or updates the relevant page in `docs/src/content/docs/`
- Link the PR in the discussion under "Documentation PR"
- The PR remains in draft until ratification

### 4. Endorse

- At least two keepers must explicitly endorse the proposal
- Endorsement via thumbs-up reaction or comment
- Endorsement indicates agreement with both the proposal and the draft PR

### 5. Objection Window

- Seven days from the second keeper endorsement
- Objections raised during this window must be addressed before ratification
- A quorum of keepers can override an objection
- If an objection stands unresolved, the proposal returns to Refine or the discussion closes with a "Declined" label

### 6. Ratify

- The draft PR is marked ready and merged
- The discussion closes with an "Accepted" label
- The new page links back to the original discussion

## Immediate Ratification

- The CTO or VP of Engineering can bypass the objection window
- The other steps still apply: a discussion, a documentation PR, and the closing "Accepted" label

## Amendments

- Ratified content remains open for adjustment
- To propose a change, open a new Discussion referencing the existing page
- Same lifecycle applies

## Metadata

Every ratified page carries:

- `proposal`: link to the original discussion
- `last-reviewed`: date of most recent keeper review
