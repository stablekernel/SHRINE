---
title: "Subagent Fanout"
description: "Decomposing work across parallel agents for speed and specialization."
---

*One coordinator, many workers, each focused on a slice.*

## The Pattern

Break a large task into independent subtasks, dispatch each to a separate agent, then synthesize results. The coordinator:
- Defines the decomposition
- Dispatches work in parallel
- Collects and synthesizes results
- Handles failures or gaps

## When to Use

- Tasks that naturally decompose (review each file, process each item)
- Work where parallelism reduces wall-clock time
- Problems benefiting from specialization (different agents for different domains)
- Large context that won't fit in a single call

## Implementation Notes

- Subtasks must be truly independent (no shared state mid-execution)
- Define clear contracts: what each agent receives, what it returns
- Plan for partial failure: some agents may fail while others succeed
- The coordinator should verify coverage, not just collect outputs

## Coordination Overhead

Fanout adds orchestration complexity. Worth it when:
- The work is embarrassingly parallel
- Single-threaded execution would be too slow
- Specialization improves quality (domain experts vs. generalists)

## Anti-patterns

- Fanning out tasks that have dependencies (agent B needs agent A's output)
- Coordinator doing too much synthesis (becomes a bottleneck)
- No fallback when an agent fails

## Related Patterns

- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): Sequential stages instead of parallel
