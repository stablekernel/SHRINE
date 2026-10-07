---
title: "Memory & Context Management"
description: "Efficient context usage and persistent memory."
status: draft
---

*Everything you put in context competes with the work for the model's attention.*

## What This Covers

Two related constraints: the context window within a session (what the model can see right now), and persistent memory across sessions (what it should not have to rediscover). Managing both is the difference between an agent that compounds knowledge and one that starts cold every time.

Indexed knowledge of the code itself (symbols, references, code graph) is a separate slot: see [Repository Context](/SHRINE/stack/repository-context/).

## Key Principles

- Context is expensive; use it deliberately
- Memory reduces rediscovery cost across sessions
- Manage context window usage to avoid truncation and retries
- Right context beats more context: irrelevant or conflicting material degrades output, not only cost

## In-Session Context

- **Route bulk output away from context**: summarize in a sandbox or subagent; only conclusions enter the main thread
- **Read narrowly**: the file section you need, not the whole file; search results, not directory dumps
- **Delegate exploration**: a subagent burns its own window and returns a paragraph
- **Watch for degradation**: long sessions drift; a fresh session with a good brief often beats pushing on
- **Detect bad context**: output got worse or less consistent after material was added; remove before adding
- **Failed attempts are context too**: after two corrections on one point, restart with a better brief ([Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/#session-rule))

## Cross-Session Memory

- **What to persist**: methods and corrections, not facts you can re-derive from the code
- **Capture at correction time**: the moment you learn something the hard way is the moment to write it down
- **Curate**: stale memory is worse than none; a memory that contradicts current code gets trusted anyway
- **Resolve conflicts**: two entries that disagree are worse than none; resolve them, do not append a third
- **Retrieval matters as much as storage**: memory nobody surfaces is memory nobody has ([RAG](/SHRINE/patterns/rag/))

## Standing Instructions

A short per-repo instruction file the harness loads at the start of every session. It holds what the agent needs every time and cannot cheaply derive from the code.

- **Contents**: build, test, and lint commands; naming and error-handling idioms; directories not to touch; one exemplar file per common change
- **Keep it short**: every line competes with the work for attention; a long file buries the line that mattered
- **Grow it from corrections**: add a line when the same miss happens twice, not from upfront guesses ([Discovery Propagation](/SHRINE/patterns/discovery-propagation/))
- **Promote when enforceable**: once a lint or hook can check a line, move it there and delete the line
- **Prune**: drop lines the current model follows without being told ([Deliberate Currency](/SHRINE/principles/deliberate-currency/))
- **Scope by layer** per [Authority Cascade](/SHRINE/principles/authority-cascade/): put each line at the narrowest layer that needs it
- **No conflicts**: a stale or contradicting line is worse than a missing one; it tends to get followed

## Key Considerations

- What is the cost of rediscovering this vs. maintaining it as memory?
- Who or what invalidates a memory when the underlying reality changes?
- Does the harness load memory automatically, or does retrieval depend on someone remembering to look?
- Are you caching stable context (system prompts, docs) instead of resending it?

## Anti-patterns

- Dumping whole files or logs into context "just in case"
- Persisting facts that drift (line numbers, versions) instead of durable methods
- One giant memory file nobody reads instead of small, titled, searchable entries
- Treating compaction/truncation as free; it silently discards what you needed
- Fixing a miss by adding context without removing the line that caused it
- A standing instruction file that only grows

## Related

- [RAG](/SHRINE/patterns/rag/): irrelevant retrieved content gets used anyway
- [Discovery Propagation](/SHRINE/patterns/discovery-propagation/): over-propagation drowns signal
- [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/): inconsistent conventions cost context and corrections
- [Correction Diagnosis](/SHRINE/patterns/correction-diagnosis/): context is two links in the cause chain
