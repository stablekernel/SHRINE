---
title: "Pipeline Orchestration"
description: "Chaining stages where each builds on the previous."
---

*Assembly line: each stage transforms and passes forward.*

## The Pattern

Structure work as sequential stages, where:
- Each stage has a clear input and output contract
- Output of stage N becomes input to stage N+1
- Stages can be swapped, versioned, or optimized independently

## When to Use

- Multi-step transformations (draft → review → polish)
- Tasks with natural phases (research → plan → execute)
- When intermediate outputs are valuable checkpoints
- Processes that benefit from separation of concerns

## Implementation Notes

- Define clear interfaces between stages
- Consider checkpointing: save intermediate state for debugging or retry
- Each stage should be independently testable
- Failures should identify which stage broke

## Example Pipelines

**Research Pipeline**
1. Query expansion (what to search for)
2. Search execution (gather sources)
3. Extraction (pull relevant facts)
4. Synthesis (combine into answer)

**Code Review Pipeline**
1. Diff analysis (what changed)
2. Impact assessment (what could break)
3. Finding generation (specific issues)
4. Priority ranking (what matters most)

## Anti-patterns

- Stages that are too coupled (can't run one without all the others)
- No visibility into intermediate state
- Monolithic "do everything" stages that defeat the purpose

## Related Patterns

- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): Parallel instead of sequential
