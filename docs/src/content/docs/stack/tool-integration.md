---
title: "Tool Integration"
description: "Function calling, tool protocols, and external APIs: design, context cost, and security."
status: draft
---

*Models are more useful when they can act, and more dangerous.*

## Why Tools Matter

- Models can read files, run code, and query APIs
- Tools extend capability beyond text generation
- Tools enable agentic workflows
- Tool results ground output in real data

## Integration Patterns

### Function Calling
- Define functions the model can invoke
- The model decides when and how to call
- Results feed back into generation

### Tool Protocols
- A standard interface such as the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP)
- A server provides tools, resources, and prompts
- The harness connects to servers and orchestrates calls

### Direct API Access
- The model generates API calls
- The system executes them and returns results
- Verify API responses before acting on them

## Tool Design

- **Descriptions written for the model**: purpose, inputs, edge cases, and how it differs from similar tools ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents))
- **Minimal required parameters**: fewer ways to call it wrong
- **Structured errors**: error code, cause, and next step the model can act on
- **Idempotency**: a retried call does not double the effect; accept a request key on writes
- **Pagination and filters**: return a page and a cursor, not the whole dataset, to protect context
- **Concise results**: return the fields the task needs, not the full record

## Context Cost

- Every loaded tool definition takes context on every request
- Large catalogs slow agents and raise cost, and so do large intermediate results ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp))
- Load tools on demand: a small core set, plus search or per-task loading for the rest
- Similar tools with vague descriptions raise wrong-tool calls

## Security

- **Tool output is untrusted input**: fetched pages, files, tickets, and API results can carry instructions
- Indirect prompt injection plants instructions in data the model will retrieve ([Greshake et al.](https://arxiv.org/abs/2302.12173), [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/))
- RAG and fine-tuning do not fully mitigate prompt injection ([OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/))
- **Least privilege**: scope each credential to the tools and resources the task needs
- **Break the trifecta**: avoid private data, untrusted content, and an exfiltration path in one session ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/))
- **Approval gates**: outward-facing or destructive calls wait for a human ([Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/), [Human in the Loop](/SHRINE/principles/human-in-the-loop/))
- **Sandbox execution**: run generated code with no ambient credentials
- **Audit log**: every tool call, arguments, caller, and result status ([Observability](/SHRINE/stack/observability/))

## Worked Example

- **Tool**: a ticket-tracker integration for a triage agent
- **Read tools**: `search_tickets`, `get_ticket`; paginated, return summary fields only
- **Write tools**: `add_comment`, `update_status`; separate server, separate credential
- **Scope**: read token limited to one project; write token issued only after approval
- **Injection handling**: ticket bodies are treated as data; the session that reads them has no write tools loaded
- **Checkpoint**: the agent outputs a proposed comment and status change; a human approves before a write step runs it
- **Errors**: `update_status` returns `invalid_transition` with the allowed states, so the agent can correct itself

## Anti-patterns

- Too many tools loaded at once (model gets confused, context fills)
- Vague tool descriptions
- No error handling, or errors the model cannot act on
- Trusting tool output without validation
- One broad credential shared by read and write tools
- Outward-facing actions with no approval step

## Related

- [Structured Output](/SHRINE/patterns/structured-output/): checkable tool arguments
- [Verification Loops](/SHRINE/patterns/verification-loops/): check results before acting
- [Unattended Runs](/SHRINE/patterns/unattended-runs/): tool limits when no human is watching
- [Checkpoint Gates](/SHRINE/patterns/checkpoint-gates/): human approval before risky tool calls
