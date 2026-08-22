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

## Anti-patterns

- Retrieving too much (floods context, buries signal)
- Retrieving irrelevant content (model tries to use it anyway)
- Not testing retrieval (generation fails silently on bad retrieval)
- Assuming RAG fixes hallucination (it reduces, doesn't eliminate)

## Cost Considerations

Every retrieved chunk uses context tokens. Balance coverage against cost.
