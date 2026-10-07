---
title: "RAG (Retrieval-Augmented Generation)"
description: "Ground responses in retrieved context."
---

*Don't rely on what the model memorized. Give it the source.*

## The Pattern

Before generating, retrieve relevant documents/data and include them in context. The model generates based on provided sources rather than training data alone.

## When to Use

- Questions about your specific data (docs, code, logs)
- Current information (training data is stale)
- Verifiable claims (source can be cited)
- Domain-specific knowledge not in training

## When Not to Use

- The answer is in the model's general knowledge and does not change
- The whole source fits in context; include it directly
- Retrieval quality is untested; fix retrieval first

## Components

1. **Retrieval**: Find relevant chunks (vector search, keyword, hybrid)
2. **Context assembly**: Format retrieved content for the prompt
3. **Generation**: Model answers using provided context
4. **Citation**: Optionally trace claims back to sources

## Implementation Tips

- Chunk documents appropriately (not too big, not too small)
- Retrieve more than you need, then filter/rank
- Include source metadata so the model can cite
- Test retrieval quality separately from generation quality

## Worked Example

- **Illustrative case** (hypothetical)
- **Task**: answer "what is our retry policy for payment webhooks?"
- **Without retrieval**: a generic answer (exponential backoff, 5 tries) that does not match the service
- **With retrieval**: search the runbooks and the webhook config; pass the top 3 chunks with file paths
- **Result**: the answer cites `config/webhooks.yaml` (8 tries, 1 hour cap); a reviewer checks the citation in seconds

## Anti-patterns

- Retrieving too much (floods context, buries signal)
- Retrieving irrelevant content (model tries to use it anyway)
- Not testing retrieval (generation fails silently on bad retrieval)
- Assuming RAG fixes hallucination (it reduces, doesn't eliminate)

## Cost Considerations

Every retrieved chunk uses context tokens. Balance coverage against cost.
