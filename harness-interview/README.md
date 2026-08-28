# Harness Interview

Collects structured metadata about how you use your AI coding assistant.

## Quick Start

### Flow A: CLI Harnesses (Claude Code, Cursor, Codex)

Paste this into your harness:

```
Read INTERVIEW.md and follow it.
```

Or give it the repo URL and ask it to run the interview.

### Flow B: Claude Desktop

Run the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/stablekernel/SHRINE/main/harness-interview/install.sh | bash
```

Then:
1. Restart Claude Desktop
2. Authenticate with Google when prompted
3. Ask Claude: "Run the harness interview"

For manual setup, see `desktop_config.example.json`.

## What this does

Your harness reads INTERVIEW.md and follows it to:
- Detect which harness you're running (Claude Code, Cursor, Codex, etc.)
- Enumerate your tools, MCPs, and skills
- Sample your conversation history to categorize task types
- Ask you to self-assess throughput, efficiency, and skill level
- Submit the results to SHRINE's interview endpoint

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
