---
title: "Skills & Prompts"
description: "Encoding efficient, repeatable patterns."
---

*The second time you explain a workflow to a model, you should be writing it down instead.*

## What This Covers

Turning one-off prompting wins into reusable assets: skills (packaged workflows the harness can invoke), prompt templates, and the discipline of maintaining them like code.

## Key Principles

- Encode the pattern once, stop re-paying for discovery
- Version and test prompts like code
- Periodically re-justify each skill against plain prompts on current models

## What Makes a Good Skill

- **One job**: a skill that does three things gets invoked wrong for all of them
- **Trigger clarity**: the description determines when it fires; write it for the router, not the reader
- **Enforcement over exhortation**: a script that refuses bad output beats a paragraph asking for good output
- **Progressive disclosure**: load detail on demand rather than front-loading everything into context

## Prompt Craft That Transfers

- Show, don't describe: [Few-Shot Examples](/SHRINE/patterns/few-shot-examples/) outperform abstract instructions
- Constrain the output shape: [Structured Output](/SHRINE/patterns/structured-output/) makes results machine-checkable
- Make reasoning visible when the task is judgment-heavy ([Chain of Thought](/SHRINE/patterns/chain-of-thought/))
- Build in a second pass: [Self-Critique](/SHRINE/patterns/self-critique/) catches what the first draft missed

## Key Considerations

- Is this worth encoding, or is it a one-off? (Frequency times cost of rediscovery)
- Who owns the skill when the underlying tool or API changes?
- How do you know it still works? A skill with no test rots invisibly.
- Does a newer model make the skill unnecessary? Retire aggressively.

## Anti-patterns

- Skills that duplicate what the model already does well on its own
- Prompt archaeology: nobody knows why a clause is there, so nobody removes it
- Untested skills trusted because they worked once
- A skill library that grows but never shrinks
