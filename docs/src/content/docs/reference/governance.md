---
title: "Governance"
description: "How principles, patterns, and practices are proposed, refined, and ratified."
---

## Keepers

Keepers are repository Maintainers or higher. They endorse proposals, resolve objections, and ratify additions to the Shrine.

## What Can Be Proposed

All content in the Shrine follows the same lifecycle:

- **Principles**: Behavioral standards the org commits to
- **Patterns**: Reusable techniques for working with AI
- **Stack choices**: Tool, model, or integration recommendations
- **Governance changes**: Amendments to this process

## Proposal Lifecycle

### 1. Propose

Open a Discussion in the "Proposals" category with this structure:

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

- Seven days from the first keeper endorsement
- Objections raised during this window must be addressed
- A quorum of keepers can override an objection

### 6. Ratify

- The draft PR is marked ready and merged
- The discussion closes with an "Accepted" label
- The new page links back to the original discussion

## Immediate Ratification

The CTO or VP of Engineering can bypass the seven-day window.

## Amendments

- Ratified content remains open for adjustment
- To propose a change, open a new Discussion referencing the existing page
- Same lifecycle applies

## Metadata

Every ratified page carries:
- `proposal`: link to the original discussion
- `last-reviewed`: date of most recent keeper review
