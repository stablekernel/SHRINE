---
title: "Memory & Context Management"
description: "Efficient context usage and persistent memory."
---

*Everything you put in context competes with the work for the model's attention.*

## What This Covers

Two related budgets: the context window within a session (what the model can see right now), and persistent memory across sessions (what it should not have to rediscover). Managing both is the difference between an agent that compounds knowledge and one that starts cold every time.

## Key Principles

- Context is expensive; use it deliberately
- Memory reduces rediscovery cost across sessions
- Manage context window usage to avoid truncation and retries

## In-Session Context

- **Route bulk output away from context**: summarize in a sandbox or subagent; only conclusions enter the main thread
- **Read narrowly**: the file section you need, not the whole file; search results, not directory dumps
- **Delegate exploration**: a subagent burns its own window and returns a paragraph
- **Watch for degradation**: long sessions drift; a fresh session with a good brief often beats pushing on

## Cross-Session Memory

- **What to persist**: methods and corrections, not facts you can re-derive from the code
- **Capture at correction time**: the moment you learn something the hard way is the moment to write it down
- **Curate**: stale memory is worse than none; a memory that contradicts current code gets trusted anyway
- **Retrieval matters as much as storage**: memory nobody surfaces is memory nobody has ([RAG](/patterns/rag/))

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
