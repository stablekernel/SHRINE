---
title: "Governance"
description: "How principles, patterns, and practices are proposed, refined, and ratified."
---

## Keepers

- Keepers guide what becomes official
- They surface direction and hold space for discussion

## Anything Can Be Proposed

- **Anything** that shapes how we work with AI is in scope
- No idea is too small, too unconventional, or too half-formed
- The categories below are common shapes, not boundaries:

- **Principles**: commitments that decide tradeoffs
- **Patterns**: reusable techniques, with when to use and when not to
- **Stack**: a capability slot definition or a change to its selection criteria
- **Governance changes**: amendments to this process

- Idea doesn't fit one of these? Propose it anyway
- The Refine step helps raw ideas find their shape

## Before You Propose

- Not a checklist you must pass
- The community explores these together, and the proposal template prompts for them
- Skim them, then propose anyway

- What's the cost of keeping this current as tools and practices change?
- What's the impact of accepting it?
- Is this already covered elsewhere?
- Can I demonstrate this with a real example?
- Does this scale across teams and projects?

## Proposal Lifecycle

### 1. Propose

- Open a Discussion in the "Proposals" category
- Use this structure:

```
## The Proposal
One sentence. What are you proposing?

## Why This Matters
What goes wrong without it? Cite real examples if possible.

## Keeping It Current
What's the cost of keeping this up to date as tools and practices change?

## Scope
Is this already covered elsewhere? Does it scale across teams and projects?

## Open Questions
What needs refinement before this solidifies?

## Pull Request
Link to draft PR (added once refined)
```

### 2. Refine

- The community discusses
- The proposer updates the description as consensus emerges
- Open questions get resolved or split into separate proposals

### 3. Draft PR

- Once refined, the proposer opens a draft PR with the documentation update
- The PR adds or updates the relevant page in `docs/src/content/docs/`
- Link the PR in the discussion under "Pull Request"
- The PR remains in draft until ratification

### 4. Endorse

- At least two keepers must explicitly endorse the proposal
- Endorsement via thumbs-up reaction or comment
- Endorsement indicates agreement with both the proposal and the draft PR

### 5. Objection Window

- Thirty days from the second keeper endorsement
- Objections raised during this window must be addressed before ratification
- A majority of keepers can override an objection
- If an objection stands unresolved, the proposal returns to Refine or the discussion closes with a "Declined" label

### 6. Ratify

- The draft PR is marked ready and merged
- The discussion closes with an "Accepted" label
- The new page links back to the original discussion

## Expedited Ratification

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

A stale `last-reviewed` date flags a page for keepers to re-examine.
