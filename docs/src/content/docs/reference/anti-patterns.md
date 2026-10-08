---
title: "Anti-patterns"
description: "Index of anti-patterns by the symptom you notice, linked to the page that fixes each one."
---

<!-- MAINTAINER: Derive every row from a page's "Anti-patterns" or "Signal of Violation" section; add a row when a page adds one -->

- Find the symptom you see, then follow the link to the fix
- Principles list theirs under "Signal of Violation"; patterns and stack pages under "Anti-patterns"
- Each linked section has the full list; this index keeps the most common

## Correction Loops

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Steering by chat correction | The same correction, every session | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |
| Prescribing before stating constraints | Twenty turns of "no, not like that" | [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/#signal-of-violation) |
| Verifying first, framing never | Checks pass; the wrong problem is solved | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |
| Skipping plan review | Steering the implementation in chat | [Spec, Then Build](/SHRINE/patterns/spec-then-build/#anti-patterns) |
| "Make it work" as the only criterion | No check can say the work is done | [Spec, Then Build](/SHRINE/patterns/spec-then-build/#anti-patterns) |
| Tuning the prompt over an inconsistent codebase | Prompt grows; convention misses recur | [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/#signal-of-violation) |
| Re-rolling a systematic miss | The same miss on the second attempt | [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#one-off-or-repeated) |
| Refining with no stopping criteria | Passes undo each other's work | [Iterative Refinement](/SHRINE/patterns/iterative-refinement/#anti-patterns) |

## Context and Memory

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Adding context to fix a context problem | Misses persist as the prompt grows | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns), [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| Dumping whole files or logs "just in case" | Context fills; signal gets buried | [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| Treating compaction as free | Constraints vanish mid-run | [Memory & Context](/SHRINE/stack/memory/#anti-patterns), [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| Never resetting a drifting session | Output quality falls as the session ages | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |
| Handoff summary drops a constraint | The next model or session breaks it | [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns), [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| Insights that die with the session | The same lesson is relearned | [Discovery Propagation](/SHRINE/patterns/discovery-propagation/#anti-patterns) |
| Retrieving too much or irrelevant content | Model uses content that does not apply | [RAG](/SHRINE/patterns/rag/#anti-patterns) |
| Stale code index | Agent cites code that has moved | [Repository Context](/SHRINE/stack/repository-context/#anti-patterns) |
| Too many tools loaded at once | Wrong tool picked; context fills | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Review and Verification

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Same agent and context generates and reviews | Review finds nothing the author missed | [Adversarial Review](/SHRINE/patterns/adversarial-review/#anti-patterns) |
| "Is this good?" as the critique prompt | Critique praises or lists generic tweaks | [Self-Critique](/SHRINE/patterns/self-critique/#anti-patterns) |
| "Tests pass" with no command or output | Claims cannot be checked | [Reviewable Output](/SHRINE/patterns/reviewable-output/#anti-patterns) |
| Refactor mixed with behavior change | Diffs too large to review | [Reviewable Output](/SHRINE/patterns/reviewable-output/#anti-patterns) |
| The loop edits the test until it passes | Green checks, broken behavior | [Verification Loops](/SHRINE/patterns/verification-loops/#anti-patterns) |
| Treating schema-valid as correct | Valid JSON with wrong values | [Structured Output](/SHRINE/patterns/structured-output/#anti-patterns) |
| Gates that always pass | A check nobody has seen fail | [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/#anti-patterns) |
| Using consensus to avoid thinking | Agreement accepted without reasons | [Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/#anti-patterns) |
| Not reading the reasoning | Conclusions that do not follow ship | [Chain of Thought](/SHRINE/patterns/chain-of-thought/#anti-patterns) |
| Trusting tool output without validation | Bad data flows downstream | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Delegation and Orchestration

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Delegating the architecture decision | Architecture corrected in review | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns) |
| Delegating work faster to type than to brief | Briefing costs more than writing | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns) |
| A brief with no non-goals | The diff grows past the task | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns) |
| Trusting subagent summaries over artifacts | "Tests pass" with a failing exit code | [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns), [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| Parallel agents sharing a branch | Edits collide | [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns), [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| Orchestrator doing the work itself | Coordination context runs out | [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| One mega-agent instead of decomposition | The prompt grows with every new task | [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| No resumability | A late failure restarts the whole pipeline | [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/#anti-patterns) |
| Fanout by habit | Agents spawned for work one thread finishes sooner | [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns) |

## Long Runs

| Anti-pattern | Symptom | Fix |
|---|---|---|
| No stop condition | The run never knows it is done | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns) |
| Uncapped retries | One request burns tokens and returns nothing | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns), [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#signal-of-violation) |
| Checking in every ten minutes | The human babysits an unattended run | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns) |
| Status only in chat scrollback | Nobody can tell where the run stands | [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/#anti-patterns) |
| Half-implemented feature with no note | The next session redoes or breaks it | [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| Agent rewrites acceptance tests | Progress file says done; behavior is not | [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| Failure handling added after launch | The first outage is when a fallback gets written | [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#signal-of-violation) |

## Human Checkpoints

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Undefined human boundary | Sign-off depends on who ran the agent | [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation) |
| Rubber-stamping | Near-100% approval in seconds | [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation), [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| Approval requested by prompt text only | Irreversible action taken unasked | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| A card with no recommendation | Reviewer rebuilds context to decide | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| Blocking the whole run on one decision | Work idles in the approval queue | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns), [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation) |
| Outward-facing actions with no approval step | External effects with no recorded approval | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Models and Routing

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Biggest model for everything | Cost explodes on simple tasks | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Model Selection](/SHRINE/stack/models/#anti-patterns) |
| Cheapest model for everything | Quality collapses on hard tasks | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns) |
| Routing on input length | Short, hard steps get a weak model | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| Switching models every step | Cold caches on every call | [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| No fallback model | An outage stops the work | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Model Selection](/SHRINE/stack/models/#anti-patterns) |
| Floating model alias | A regression nobody logged | [Model Selection](/SHRINE/stack/models/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |

## Testing and Evaluation

| Anti-pattern | Symptom | Fix |
|---|---|---|
| No baseline | Nobody can tell if a change helped | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Evaluation & Benchmarking](/SHRINE/stack/evaluation/#anti-patterns) |
| Exact string matching on free prose | Tests fail on rephrasing alone | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| Single runs on nondeterministic output | Flaky tests get retried or deleted | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| Debugging by regenerating | A bug "fixed" because a rerun passed | [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| Trusting a score without reading transcripts | The metric rises; the work does not improve | [Evaluation & Benchmarking](/SHRINE/stack/evaluation/#anti-patterns) |
| Testing on synthetic examples only | Real use breaks what tests passed | [Dogfooding](/SHRINE/patterns/dogfooding/#anti-patterns) |
| Not testing retrieval | Generation fails silently | [RAG](/SHRINE/patterns/rag/#anti-patterns) |

## Governance and Currency

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Settled questions reopened | The same convention argued each review | [Authority Cascade](/SHRINE/principles/authority-cascade/#signal-of-violation) |
| Conventions held in one person's head | Work stalls when they rotate off | [Authority Cascade](/SHRINE/principles/authority-cascade/#signal-of-violation) |
| Drift | Skills tuned for a retired model still load | [Deliberate Currency](/SHRINE/principles/deliberate-currency/#signal-of-violation) |
| Churn | Tooling reopened on every release | [Deliberate Currency](/SHRINE/principles/deliberate-currency/#signal-of-violation) |
| A skill library that only grows | Nobody knows why a clause is there | [Skills & Prompts](/SHRINE/stack/skills/#anti-patterns), [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| Silent mutations without review | Shared instructions change unnoticed | [Discovery Propagation](/SHRINE/patterns/discovery-propagation/#anti-patterns) |
| Switching harnesses without migrating skills | Skills and patterns lost in the move | [Harness Selection](/SHRINE/stack/harness/#anti-patterns) |

## Cost and Attention

| Anti-pattern | Symptom | Fix |
|---|---|---|
| Optimizing raw token spend | Bill falls; rework and steering rise | [TTV](/SHRINE/principles/tokens-to-value/#signal-of-violation), [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Optimizing per-call price | Total cost per outcome rises | [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| Tokens logged with no outcome ID | Nobody can state the cost of a win | [Observability & Logging](/SHRINE/stack/observability/#anti-patterns), [TTV](/SHRINE/principles/tokens-to-value/#signal-of-violation) |
| Ignoring cost until the bill arrives | Spend surprises with no breakdown | [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Hard limits on critical paths | Limits stop work that mattered | [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Traces nobody reads | Failures visible in logs, unnoticed | [Observability & Logging](/SHRINE/stack/observability/#anti-patterns) |
