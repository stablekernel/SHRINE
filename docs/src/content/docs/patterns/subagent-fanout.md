---
title: "Subagent Fanout"
description: "Split independent work across subagents that read widely and return compact results."
---

*One coordinator, many workers, each with a clean context and a narrow brief.*

## The Pattern

- A coordinator splits a task into independent slices
- Each subagent gets one slice, its own context window, and a return contract
- Subagents return summaries or structured results, not their raw reading
- The coordinator checks coverage, merges, and decides what happens next

## Why It Works

- **Context isolation is the main win for coding**: subagents read many files in their own windows and report back summaries, keeping the main thread clean ([Claude Code best practices](https://code.claude.com/docs/en/best-practices))
- **Compression**: subagents explore in parallel, then pass only the most important tokens to the lead agent ([Anthropic, multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system))
- **Fresh eyes**: a reviewer subagent sees the diff and the criteria, not the reasoning that produced the change ([Claude Code best practices](https://code.claude.com/docs/en/best-practices))

## The Cost

- Fanout multiplies tokens
- Anthropic reports agents use about 4x the tokens of chat, and multi-agent systems about 15x ([source](https://www.anthropic.com/engineering/multi-agent-research-system))
- The same post finds multi-agent systems pay off only when the task value covers that spend
- Judge fanout by [Tokens to Value](/SHRINE/principles/tokens-to-value/): cost per verified outcome, including the human attention spent reconciling results

## When to Use

- Parallel, independent strands: review each file, audit each service, research each question
- Reading that would flood the main context
- Post-implementation verification in a fresh context ([Adversarial Review](/SHRINE/patterns/adversarial-review/))
- Wall-clock time matters and slices do not wait on each other

## When Not to Use

- **Dependent subtasks**: B needs A's output; use [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/)
- **Tightly coupled coding**: Anthropic notes most coding tasks have fewer truly parallel parts than research ([source](https://www.anthropic.com/engineering/multi-agent-research-system))
- **Shared implicit decisions**: subagents that cannot see each other make conflicting assumptions, and the merge inherits the conflict ([Cognition, Don't Build Multi-Agents](https://cognition.com/blog/dont-build-multi-agents))
- **Briefing costs more than doing**: a two-file change is faster inline
- **Shared mutable state**: agents editing the same branch or files

## Contracts

- **One complete brief**: objective, scope boundaries, tools and sources, output format; vague briefs cause duplicated work and gaps ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system))
- **Return format**: schema the coordinator can merge without rereading ([Structured Output](/SHRINE/patterns/structured-output/))
- **Evidence**: every finding cites a file path and line, so claims are checkable
- **Coverage check**: coordinator compares returned slices against the dispatched list

## Worked Example

Review 12 changed files for correctness.

1. Coordinator lists the 12 paths and splits them into 4 groups of 3
2. Each subagent brief holds: the diff for its 3 files, the review criteria, and the return schema
3. Return schema per finding:
   ```json
   {"file": "src/billing/invoice.ts", "line": 88,
    "severity": "high", "claim": "Rounding drops cents on refunds",
    "evidence": "Math.floor on negative totals"}
   ```
4. Each subagent also returns `files_reviewed: [...]`
5. Coordinator checks the union of `files_reviewed` equals the 12 paths; one group missed a file, so it re-dispatches that file alone
6. Coordinator dedups findings by file, line, and claim
7. Coordinator opens only the cited lines for high-severity findings before reporting

## Pitfalls

- **Trusting summaries over artifacts**: a subagent says "tests pass"; check the exit code or the file
- **Agents sharing a branch**: parallel edits collide; give each writer its own worktree or keep writers to one
- **Coordinator re-reads everything**: this cancels the context win; spot-check cited evidence instead
- **No partial-failure plan**: one failed slice should re-run alone, not restart the fanout
- **Fanout by habit**: spawning agents for work one thread would finish sooner

## Related

- [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/): sequential stages for dependent work
- [Task Routing](/SHRINE/patterns/task-routing/): fanout workers often run on a smaller tier
- [Step-Level Routing](/SHRINE/patterns/step-level-routing/): lighter models for search and read steps
- [Agent Architecture](/SHRINE/stack/agent-architecture/): where coordinators and workers live
