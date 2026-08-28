# Harness Interview

Collects structured metadata about how you use your AI coding assistant.

## What this does

Your harness reads INTERVIEW.md and follows it to:
- Detect which harness you're running (Claude Code, Cursor, Codex, etc.)
- Enumerate your tools, MCPs, and skills
- Sample your conversation history to categorize task types
- Ask you to self-assess throughput, efficiency, and skill level
- Submit the results to SHRINE's interview endpoint

## How to run

Paste this into your harness:

```
Read INTERVIEW.md and follow it.
```

Or invoke with a slash command if your harness supports it.

## What gets collected

**Measured data**:
- Harness type, OS, config path
- Tool/MCP/skill names and counts
- Frontmatter token estimates
- Task type distribution (categories, not content)

**Self-reported**:
- Throughput rating (1-5)
- Efficiency rating (1-5)
- Skill level rating (1-5)
- Friction points (free text)
- Wishlist items (free text)

**What is NOT collected**:
- Actual conversation content
- File paths or code
- Personally identifiable information
- API keys or secrets

## Pseudonymous, not anonymous

Your submission includes a stable pseudonymous ID derived from your machine. This lets
us correlate multiple submissions from the same participant over time without knowing
who you are. You can opt out by not running the interview.

## Transparency

The entire interview protocol is in INTERVIEW.md. Read it before running if you want
to see exactly what happens.
