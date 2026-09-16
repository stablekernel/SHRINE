---
title: "Repository Context"
description: "Indexed codebase knowledge exposed to agents."
---

*Let the agent look up the codebase instead of rereading it.*

## What This Covers

- Indexed knowledge of the code itself: symbols, definitions, references, call and dependency graphs
- Exposed to agents as tools (usually MCP) or as a precomputed map
- Distinct from [Memory & Context](/SHRINE/stack/memory/), which holds agent and session state
- Rule of thumb: repository context is derived from the code; memory is what the code cannot tell you

## Key Principles

- Query the index before reading whole files
- Navigate by symbol, not by grep, when a semantic tool exists
- The index must track the code; a stale graph is worse than none
- Serves [Consistency as Leverage](/SHRINE/principles/consistency-as-leverage/): consistent code indexes cleanly and predicts well

## Approaches

- **LSP-backed navigation**: go-to-definition, find-references, rename via the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- **Symbolic MCP tools**: symbol lookup and symbol-level edits exposed to the agent
- **Code knowledge graph**: parsed codebase stored as a queryable graph
- **Repo map**: ranked summary of files and signatures sent with each request

## Current Stack

*Document your org's evaluated tools here.*

| Tool | Approach | Notes |
|------|----------|-------|
| [Serena](https://github.com/oraios/serena) | Symbolic MCP tools, LSP-backed | Semantic retrieval and editing |
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Code knowledge graph over MCP | Persistent index, many languages |
| [Aider repo map](https://aider.chat/docs/repomap.html) | Repo map | Built into Aider; graph-ranked to a token budget |

## Key Considerations

- How does the index refresh after edits, and can the agent detect staleness?
- Does it cover every language in the repo?
- What does one query cost in context compared with reading the file?

## Anti-patterns

- Storing session decisions in the code index, or code structure in memory
- Dumping the full repo map into every prompt regardless of task
- Trusting an index that has not been refreshed since the last large change
