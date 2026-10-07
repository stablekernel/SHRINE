---
title: "Evaluation & Benchmarking"
description: "Define the win, build evals on real cases, and measure whether your stack works."
status: draft
---

*If you can't measure it, you can't improve it.*

## Why Evaluate

- Detect regressions before users do
- Compare alternatives objectively
- Justify changes with data
- Track [TTV](/SHRINE/principles/tokens-to-value/) over time

## First Step: Define the Win

- Name what counts as success for each workload class: merged PR, resolved ticket, correct extraction
- Write it down before building cases; every metric below divides by it

## What to Measure

### Outcome Metrics
- Success rate (did it work?)
- Quality score (how good was it?)
- Time to completion
- Human intervention rate
- Acceptance rate: share of delegated outputs accepted as delivered, counted apart from those accepted after correction
- Corrections per task: correction turns, each tagged with its cause ([Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#cause-chain))
- Diff size per accepted output: lines and files changed; large diffs tend to raise review cost

### Cost Metrics
- Tokens per outcome
- Human attention per outcome (minutes, interventions) ([TTV](/SHRINE/principles/tokens-to-value/))
- Retry rate
- Context utilization

### Operational Metrics
- Latency (time to first token, total time)
- Error rate
- Availability

## Evaluation Types

- **Offline evals**: Run against a static dataset, compare outputs
- **Online evals**: Monitor production traffic
- **A/B tests**: Compare alternatives on live traffic
- **Human evals**: Expert judgment on quality

## Building an Eval Suite

- **Seed from real failures**: every production miss or human correction becomes a case
- **Start small**: about 20 cases drawn from real usage was enough to see large effects in one vendor's early work ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system))
- **Pass definition per case**: exact, statistical, or behavioral ([Reproducibility](/SHRINE/principles/reproducibility/))
- **N-run thresholds**: run each case several times; set the pass bar on the aggregate
- **Baseline first**: record current scores before changing anything
- **Run on every change**: prompt, skill, model, or tool change ([Prompt Regression Testing](/SHRINE/patterns/prompt-regression/))
- **Isolate trials**: clean environment per run; shared state causes correlated failures ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))

## pass@k vs pass^k

- **pass@k**: at least one of k attempts succeeds; rises with k
- **pass^k**: all k attempts succeed; falls with k
- 75% per-trial success gives about 42% pass^3 ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))
- Use pass@k when one success is enough and a human or check picks it
- Use pass^k when consistency is the product, such as a customer-facing agent

## Grading

- Grade the outcome in the environment (tests pass, record written), not the path taken
- Checking exact tool-call sequences is brittle; agents find valid paths designers did not anticipate ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))
- Keep the full transcript for every trial
- Read transcripts regularly; a failure may be a grader bug, not an agent bug

## LLM-as-Judge

- Acceptable for open-ended output where no deterministic check exists
- Prefer code-based graders when a deterministic check is possible
- Calibrate against human labels before trusting scores; recheck periodically
- Known biases: position, verbosity, and self-enhancement ([Zheng et al.](https://arxiv.org/abs/2306.05685))
- Same study: strong judges reached over 80% agreement with human preferences, about human-to-human level
- Give the judge a rubric and an "unknown" option to reduce guessing ([Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents))

## On Model Change

- Rerun the full suite on the candidate model before switching
- Remove harness components one at a time to find which are still load-bearing ([Anthropic](https://www.anthropic.com/engineering/harness-design-long-running-apps))
- Tie reruns to [Deliberate Currency](/SHRINE/principles/deliberate-currency/) tripwires

## Measure, Don't Ask

- Measure time and outcomes directly; self-reported speedup is unreliable
- In one RCT, experienced open-source developers took 19% longer with AI tools, yet estimated a 20% speedup afterward ([METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/))
- Limits: 16 developers on their own mature repositories, early-2025 tools; METR marks these results as out of date (kept here as history)
- Follow-up (Feb 2026): METR judged its late-2025 rerun an unreliable signal, mainly because developers declined to work without AI; it believes speedup is likely higher now, but its data is only weak evidence of how much ([METR](https://metr.org/blog/2026-02-24-uplift-update/))
- Takeaway: measure your own workflows; published numbers age fast

## Individual Baseline

A bounded way for one engineer to see whether delegation pays off, instead of estimating it.

- **Log per task**: mode (delegated, paired, by hand); minutes briefing; minutes reviewing and fixing; acceptance rate, corrections per task, diff size
- **Compare** like tasks across modes, not across task types
- **Time bound**: two weeks
- **Stop early** when one cause tag owns most corrections; that is the answer
- **Abort** if logging takes more than a few minutes per task; simplify the log, then restart
- **Output**: the top cause tag is the next input to fix; share the log as evidence for the workload's win definition ([TTV](/SHRINE/principles/tokens-to-value/#open-questions))

## Team Baseline

The same protocol, run by a team on shared workflows.

- **Pick workflows**: two or three recurring ones the team does weekly, such as bug fixes or endpoint additions
- **Name an owner**: one person collects the logs and writes the report
- **Log**: each engineer uses the [Individual Baseline](#individual-baseline) fields, plus workflow name
- **Time bound**: two weeks
- **Abort** if fewer than half the team is logging after the first week, or logging takes more than a few minutes per task; simplify, then restart
- **Report fields**: per workflow and mode, median minutes briefing and reviewing; acceptance rate; corrections per task; top cause tag; one recommended input fix
- **Output**: the report goes to the team's discussion as evidence; the top fix gets an owner

## Worked Example

- **Illustrative case** (hypothetical numbers)
- **Task**: extract priority, component, and repro steps from support tickets into a schema ([Structured Output](/SHRINE/patterns/structured-output/))
- **Cases**: 20 real tickets, including 6 that previously produced wrong output
- **Pass per case**: schema valid, priority and component exact match, repro steps judged present (behavioral)
- **Threshold**: each case runs 5 times; suite passes at 95% of runs, no case below 4 of 5
- **Baseline**: current model passes 98 of 100 runs
- **Model swap**: cheaper candidate passes 88 of 100; three multi-issue tickets fail on component
- **Decision**: swap blocked; the three tickets are added to the regression set

## Anti-patterns

- Vanity metrics (measuring what's easy, not what matters)
- No baseline (can't tell if you're improving)
- Evaluating once (things drift)
- Over-fitting to evals (gaming the metric)
- Trusting a score without reading transcripts
