---
title: "Pipeline Orchestration"
description: "Chain stages with explicit contracts and a gate at every handoff."
proposal: "https://github.com/stablekernel/SHRINE/commit/d5f06a07"
last-reviewed: 2026-10-07
status: ratified
---

*Assembly line: each stage transforms, checks, and passes forward.*

## The Pattern

- Structure work as sequential stages
- Each stage has an input contract, an output contract, and a gate
- Output of stage N becomes input to stage N+1 only after its gate passes
- Anthropic calls this prompt chaining: each call processes the previous output, with programmatic checks on intermediate steps ([Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents))
- It trades latency for accuracy by making each call an easier task (same source)

## When to Use

- The task splits cleanly into fixed, known phases
- Intermediate outputs are worth keeping as checkpoints
- Stages need different skills, tools, or model tiers
- A failure should be traceable to one stage

## When Not to Use

- **Exploratory work**: phases are unknown until you start; use an agent loop or [Subagent Fanout](/SHRINE/patterns/subagent-fanout/) for breadth
- **Single-step tasks**: a pipeline adds handoffs with nothing to hand off
- **Constant back-and-forth**: stages that must renegotiate each other's output belong in one stage
- **Parallel, independent work**: fan out instead of queueing

## Stage Contract

Every stage defines three things.

- **Input schema**: what it requires, and what it refuses
- **Output schema**: a checkable artifact ([Structured Output](/SHRINE/patterns/structured-output/))
- **Gate**: a check that must pass before handoff ([Verification Loops](/SHRINE/patterns/verification-loops/))

```yaml
stage: implement
input:  spec.md          # must list acceptance criteria
output: branch + diff    # compiles, touches only files in spec scope
gate:   build passes; tests for each acceptance criterion exist and pass
on_fail: retry this stage (max 2), then stop and report
```

## Worked Example

Ticket to verified change, each stage writing a checkpointed artifact.

| Stage | Input | Output artifact | Gate |
|------|------|------|------|
| 1. Ticket | Issue text | `ticket.json` (goal, constraints) | Goal and constraints non-empty |
| 2. Spec | `ticket.json` | `spec.md` | Every acceptance criterion is testable |
| 3. Implement | `spec.md` | Branch + diff | Build and lint pass |
| 4. Verify | Diff + `spec.md` | `verify.json` | Every criterion maps to a passing test |

A stage fails:

- Stage 4 reports criterion 3 has no test
- The pipeline reruns stage 3 with the gap as input
- Stages 1 and 2 are not rerun; their artifacts are on disk
- Stage 4 reruns and passes

See [Spec Then Build](/SHRINE/patterns/spec-then-build/) for stages 1 and 2 in depth.

## Per-Stage Routing

- Route each stage to the smallest tier that passes its gate ([Task Routing](/SHRINE/patterns/task-routing/))
- Extraction and formatting stages often run on a fast tier
- Spec and review stages usually need a capable tier
- Log the tier per stage so misroutes show up as gate failures

## Implementation Notes

- Write each stage output to durable storage before the next stage starts
- Make stages idempotent so a rerun does not double-apply
- Record which stage and which gate failed, with the input that caused it
- Test each stage alone with fixture inputs

## Pitfalls

- **No gates**: a bad spec flows into a bad implementation that passes its own weak checks; errors compound downstream
- **No resumability**: a stage-4 failure restarts from stage 1 and repays every token
- **Coupled stages**: one stage cannot run without the internals of another
- **Monolithic stages**: a "do everything" stage hides which part failed
- **Gates that always pass**: a check nobody has seen fail proves nothing

## Related

- [Subagent Fanout](/SHRINE/patterns/subagent-fanout/): parallel instead of sequential
- [Structured Output](/SHRINE/patterns/structured-output/): machine-checkable stage outputs
- [Verification Loops](/SHRINE/patterns/verification-loops/): the retry loop inside a gate
- [Spec Then Build](/SHRINE/patterns/spec-then-build/): a two-stage pipeline for code
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): human approval at a seam
- [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/): deterministic scaffolds as stages
- [Task Routing](/SHRINE/patterns/task-routing/): pick a tier per stage
- [Agent Architecture & Orchestration](/SHRINE/stack/agent-architecture/): where the pipeline topology fits
