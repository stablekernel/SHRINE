---
title: "Governance"
description: "How principles, patterns, and practices are proposed, refined, and ratified."
---

## Keepers

Keepers guide what becomes official. They surface direction and hold space for discussion.

## Anything Can Be Proposed

**Anything.** If it shapes how we work with AI, it's in scope: no idea is too small, too unconventional, or too half-formed. The categories below are common shapes, not boundaries:

- **Principles**: Behavioral standards the org commits to
- **Patterns**: Reusable techniques for working with AI
- **Stack choices**: Tool, model, or integration recommendations
- **Governance changes**: Amendments to this process

If your idea doesn't fit neatly into one of these, propose it anyway. The Refine step exists to help raw ideas find their shape.

## Before You Propose

The questions below aren't a checklist you must pass; they're the questions the community will explore together, and the proposal template prompts you for them. Skim them, then propose anyway.

- What's the cost of keeping this current as tools and practices change?
- What's the impact of accepting it?
- Is this already covered elsewhere?
- Can I demonstrate this with a real example?
- Does this scale across teams and clients?
- Would I follow this myself?
- Is this the right altitude: principle, pattern, or stack?

## Proposal Lifecycle

### 1. Propose

- Open a Discussion in the "Proposals" category
- The proposal form asks for:

```
Self-Assessment
Checkboxes for the questions in Before You Propose.

Proposal Type
Principle, Pattern, Stack Choice, or Governance Change.

The Proposal
One sentence. What are you proposing?

Why This Matters
What goes wrong without it? Cite real examples if possible.

Open Questions
What needs refinement before this solidifies?

Prior Art
Related patterns, external references, or internal docs.

Documentation PR
Link to the draft PR (added once refined).
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

## Page Status

Every principle, pattern, and stack page shows its status under the title and in the sidebar.

| Status | Meaning | Sections |
|---|---|---|
| Ratified | Adopted through this lifecycle or by owner decision; changes need a Discussion | Principles, Patterns |
| Draft | Under refinement; use as guidance, expect changes without the full lifecycle | Stack, Current Stack Roster |

- Set by the `status` frontmatter field: `ratified` or `draft`
- Promoting a Draft page to Ratified follows the lifecycle above

## Metadata

Every ratified page carries:

- `proposal`: link to the original discussion
  - Pages ratified without a Discussion link the PR or commit that added them
- `last-reviewed`: date of most recent keeper review

Keepers periodically sweep pages whose `last-reviewed` date has gone stale, re-examining whether the guidance still holds.
