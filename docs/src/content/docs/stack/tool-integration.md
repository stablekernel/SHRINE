---
title: "Tool Integration"
description: "MCP servers, function calling, and external APIs."
---

*Models are more useful when they can act.*

## Why Tools Matter

- Models can read files, run code, query APIs
- Extends capability beyond text generation
- Enables agentic workflows
- Grounds output in real data

## Integration Patterns

### Function Calling
- Define functions the model can invoke
- Model decides when/how to call
- Results feed back into generation

### MCP (Model Context Protocol)
- Standardized tool interface
- Server provides tools, resources, prompts
- Client (harness) orchestrates

### Direct API Access
- Model generates API calls
- System executes and returns results
- Verification of API responses

## Tool Design Principles

- Clear, unambiguous tool descriptions
- Minimal required parameters
- Useful error messages
- Idempotent when possible

## Security Considerations

- What can the model access?
- Permission scoping
- Audit logging
- Sandboxing execution

## Anti-patterns

- Too many tools (model gets confused)
- Vague tool descriptions
- No error handling
- Trusting tool output without validation
