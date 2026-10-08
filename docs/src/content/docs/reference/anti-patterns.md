---
title: "Anti-patterns"
description: "Index of anti-patterns by the symptom you notice, linked to the page that fixes each one."
---

<!-- MAINTAINER: Derive every row from a page's "Anti-patterns" or "Signal of Violation" section, the Correction Diagnosis cause chain, or the patterns overview symptom table; add a row when any of them adds one -->

- Find the symptom you see, then follow the link to the fix
- Principles list theirs under "Signal of Violation"; patterns and stack pages under "Anti-patterns"
- Each linked section has the full list; this index keeps the most common

## Correction Loops

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Same correction, again and again | Steering by chat correction | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |
| Twenty turns of "no, not like that" | Prescribing before stating constraints | [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/#signal-of-violation) |
| Solved the wrong problem | No problem statement or constraints; verifying first, framing never | [Problem Before Prescription](/SHRINE/principles/problem-before-prescription/), [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Wandered mid-task; steering the implementation in chat | Skipping plan review; no plan review or milestone | [Spec, Then Build](/SHRINE/patterns/spec-then-build/#anti-patterns), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| No check can say the work is done | "Make it work" as the only criterion | [Spec, Then Build](/SHRINE/patterns/spec-then-build/#anti-patterns) |
| Prompt grows while misses recur | Tuning the prompt over an inconsistent codebase; adding context to fix a context problem | [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/#signal-of-violation), [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns), [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| The same miss on the second attempt | Re-rolling a systematic miss | [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#signal-of-violation) |
| Passes undo each other's work | Refining with no stopping criteria | [Iterative Refinement](/SHRINE/patterns/iterative-refinement/#anti-patterns) |
| Wrong format or style | No exemplar to mirror | [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/), [Structured Output](/SHRINE/patterns/structured-output/), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Shallow answers on hard steps; shallow reasoning on a hard step | Tier too small for the step | [Chain of Thought](/SHRINE/patterns/chain-of-thought/), [Step-Level Routing](/SHRINE/patterns/step-level-routing/), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Model over-fits to specifics | Examples that are too similar | [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/#anti-patterns) |
| Diminishing returns; context waste | Too many examples | [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/#anti-patterns) |

## Context and Memory

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Context fills; signal gets buried | Dumping whole files or logs "just in case" | [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| Ignored a repo convention | Convention not written down, or inconsistent | [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Output got worse after material was added | Irrelevant or conflicting context | [Memory & Context](/SHRINE/stack/memory/#in-session-context), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Long run drifts or loses the thread | Automatic summary as the only memory | [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns), [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/) |
| Confident answers about your own data that are wrong | Relying on what the model memorized | [RAG](/SHRINE/patterns/rag/) |
| A constraint is lost across compaction or handoff, and the next model or session breaks it | Treating compaction as free; a handoff summary that drops a constraint | [Memory & Context](/SHRINE/stack/memory/#anti-patterns), [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns), [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| Output quality falls as the session ages | Never resetting a drifting session | [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#anti-patterns) |
| Same fix made in two sessions | Insights that die with the session; correction never captured | [Discovery Propagation](/SHRINE/patterns/discovery-propagation/#anti-patterns), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Model uses content that does not apply | Retrieving too much or irrelevant content | [RAG](/SHRINE/patterns/rag/#anti-patterns) |
| Agent cites code that has moved | Stale code index | [Repository Context](/SHRINE/stack/repository-context/#anti-patterns) |
| Wrong tool picked; context fills | Too many tools loaded at once | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Review and Verification

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Review finds nothing the author missed | Same agent and context generates and reviews | [Adversarial Review](/SHRINE/patterns/adversarial-review/#anti-patterns) |
| Critique praises or lists generic tweaks | "Is this good?" as the critique prompt | [Self-Critique](/SHRINE/patterns/self-critique/#anti-patterns) |
| A "tests pass" claim that cannot be checked, or that hides a failing exit code | "Tests pass" with no command or output; trusting subagent summaries over artifacts | [Reviewable Output](/SHRINE/patterns/reviewable-output/#anti-patterns), [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns), [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| Diffs too large to review | Refactor mixed with behavior change; task too large for one brief | [Reviewable Output](/SHRINE/patterns/reviewable-output/#anti-patterns), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Green checks, broken behavior | The loop edits the test until it passes | [Verification Loops](/SHRINE/patterns/verification-loops/#anti-patterns) |
| Plausible code that does not run | No runnable check | [Verification Loops](/SHRINE/patterns/verification-loops/), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| Valid JSON with wrong values | Treating schema-valid as correct | [Structured Output](/SHRINE/patterns/structured-output/#anti-patterns) |
| The scaffold keeps emitting the old shape | Scaffold drifts from the target schema | [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/#anti-patterns) |
| The two copies disagree over time | Validation duplicated in prompt and code | [Mechanical Scaffolding](/SHRINE/patterns/mechanical-scaffolding/#anti-patterns) |
| A check nobody has seen fail | Gates that always pass | [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/#anti-patterns) |
| Agreement accepted without reasons | Using consensus to avoid thinking | [Multi-Model Consensus](/SHRINE/patterns/multi-model-consensus/#anti-patterns) |
| Conclusions that do not follow ship | Not reading the reasoning | [Chain of Thought](/SHRINE/patterns/chain-of-thought/#anti-patterns) |
| Bad data flows downstream | Trusting tool output without validation | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Delegation and Orchestration

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Architecture corrected in review | Delegating the architecture decision | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns) |
| Fixing output takes longer than writing it; faster to have written it by hand | Delegating work faster to type than to brief; wrong work delegated | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns), [Cause Chain](/SHRINE/patterns/correction-diagnosis/#cause-chain) |
| The diff grows past the task | A brief with no non-goals | [Delegation Fit](/SHRINE/patterns/delegation-fit/#anti-patterns) |
| Edits collide | Parallel agents sharing a branch | [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns), [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| Coordination context runs out | Orchestrator doing the work itself | [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| The prompt grows with every new task | One mega-agent instead of decomposition | [Agent Architecture](/SHRINE/stack/agent-architecture/#anti-patterns) |
| A late failure restarts the whole pipeline | No resumability | [Pipeline Orchestration](/SHRINE/patterns/pipeline-orchestration/#anti-patterns) |
| Agents spawned for work one thread finishes sooner | Fanout by habit | [Subagent Fanout](/SHRINE/patterns/subagent-fanout/#anti-patterns) |

## Long Runs

| Symptom | Anti-pattern | Fix |
|---|---|---|
| The run never knows it is done | No stop condition | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns) |
| One request burns tokens and returns nothing | Uncapped retries | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns), [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#signal-of-violation) |
| The human babysits an unattended run | Checking in every ten minutes | [Unattended Runs](/SHRINE/patterns/unattended-runs/#anti-patterns) |
| Nobody can tell where the run stands | Status only in chat scrollback | [Progress Breadcrumbs](/SHRINE/patterns/progress-breadcrumbs/#anti-patterns) |
| The next session redoes or breaks it | Half-implemented feature with no note | [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| Progress file says done; behavior is not | Agent rewrites acceptance tests | [Context Handoff](/SHRINE/patterns/context-handoff/#anti-patterns) |
| The first outage is when a fallback gets written | Failure handling added after launch | [Fail Fast, Recover Smart](/SHRINE/principles/fail-fast-recover-smart/#signal-of-violation) |

## Human Checkpoints

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Sign-off depends on who ran the agent | Undefined human boundary | [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation) |
| Near-100% approval in seconds | Rubber-stamping | [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation), [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| Agent took an irreversible action unasked | Approval requested by prompt text only | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| Reviewer rebuilds context to decide | A card with no recommendation | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns) |
| Work idles in the approval queue | Blocking the whole run on one decision | [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/#anti-patterns), [Human in the Loop](/SHRINE/principles/human-in-the-loop/#signal-of-violation) |
| External effects with no recorded approval | Outward-facing actions with no approval step | [Tool Integration](/SHRINE/stack/tool-integration/#anti-patterns) |

## Models and Routing

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Cost explodes on simple tasks | Biggest model for everything | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Model Selection](/SHRINE/stack/models/#anti-patterns) |
| Quality collapses on hard tasks | Cheapest model for everything | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns) |
| Short, hard steps get a weak model | Routing on input length | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| Cold caches on every call | Switching models every step | [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| An outage stops the work | No fallback model | [Task Routing](/SHRINE/patterns/task-routing/#anti-patterns), [Model Selection](/SHRINE/stack/models/#anti-patterns) |
| A regression nobody logged | Floating model alias | [Model Selection](/SHRINE/stack/models/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |

## Testing and Evaluation

| Symptom | Anti-pattern | Fix |
|---|---|---|
| A prompt change broke something that worked; nobody can tell if a change helped | No baseline | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Evaluation & Benchmarking](/SHRINE/stack/evaluation/#anti-patterns) |
| Tests fail on rephrasing alone | Exact string matching on free prose | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| Flaky tests get retried or deleted | Single runs on nondeterministic output | [Prompt Regression Testing](/SHRINE/patterns/prompt-regression/#anti-patterns), [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| A bug "fixed" because a rerun passed | Debugging by regenerating | [Reproducibility](/SHRINE/principles/reproducibility/#signal-of-violation) |
| The metric rises; the work does not improve | Trusting a score without reading transcripts | [Evaluation & Benchmarking](/SHRINE/stack/evaluation/#anti-patterns) |
| Real use breaks what tests passed | Testing on synthetic examples only | [Dogfooding](/SHRINE/patterns/dogfooding/#anti-patterns) |
| Generation fails silently | Not testing retrieval | [RAG](/SHRINE/patterns/rag/#anti-patterns) |

## Governance and Currency

| Symptom | Anti-pattern | Fix |
|---|---|---|
| The same convention argued each review | Settled questions reopened | [Authority Cascade](/SHRINE/principles/authority-cascade/#signal-of-violation) |
| Work stalls when they rotate off | Conventions held in one person's head | [Authority Cascade](/SHRINE/principles/authority-cascade/#signal-of-violation) |
| Skills tuned for a retired model still load | Drift | [Deliberate Currency](/SHRINE/principles/deliberate-currency/#signal-of-violation) |
| Tooling reopened on every release | Churn | [Deliberate Currency](/SHRINE/principles/deliberate-currency/#signal-of-violation) |
| Nobody knows why a clause is there | A skill library that only grows | [Skills & Prompts](/SHRINE/stack/skills/#anti-patterns), [Memory & Context](/SHRINE/stack/memory/#anti-patterns) |
| Shared instructions change unnoticed | Silent mutations without review | [Discovery Propagation](/SHRINE/patterns/discovery-propagation/#anti-patterns) |
| Skills and patterns lost in the move | Switching harnesses without migrating skills | [Harness Selection](/SHRINE/stack/harness/#anti-patterns) |

## Cost and Attention

| Symptom | Anti-pattern | Fix |
|---|---|---|
| Bill falls; rework and steering rise | Optimizing raw token spend | [TTV](/SHRINE/principles/tokens-to-value/#signal-of-violation), [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Total cost per outcome rises | Optimizing per-call price | [Step-Level Routing](/SHRINE/patterns/step-level-routing/#anti-patterns) |
| Nobody can state the cost of a win | Tokens logged with no outcome ID | [Observability & Logging](/SHRINE/stack/observability/#anti-patterns), [TTV](/SHRINE/principles/tokens-to-value/#signal-of-violation) |
| Spend surprises with no breakdown | Ignoring cost until the bill arrives | [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Limits stop work that mattered | Hard limits on critical paths | [Cost Management](/SHRINE/stack/cost-management/#anti-patterns) |
| Failures visible in logs, unnoticed | Traces nobody reads | [Observability & Logging](/SHRINE/stack/observability/#anti-patterns) |
