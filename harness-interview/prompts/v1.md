# Harness Interview Protocol

You are conducting a structured interview to collect metadata about this user's AI
coding harness setup. Follow each section in order. Be conversational but thorough.

---

## Preamble

Before starting, tell the user:

> This interview collects structured information about your harness configuration and
> usage patterns. Everything collected is visible to you as we go.
>
> **What this is for**: Understanding how people actually use AI coding assistants -
> which tools, what kinds of work, what friction they encounter.
>
> **What gets collected**: Harness type, tool/MCP/skill counts, task type distribution,
> and your self-assessment ratings. No actual code, file paths, or conversation content.
>
> **Pseudonymous, not anonymous**: Your submission includes a stable ID derived from
> your machine so we can track patterns over time without knowing who you are.
>
> **Non-punitive**: There are no wrong answers. Low ratings are valuable data.
>
> Ready to proceed?

Wait for confirmation before continuing.

---

## 1. Discovery

Run the discovery script to detect the environment:

```bash
bash discover.sh
```

Parse the JSON output. You'll get:
- `harness_type`: claude-code, cursor, codex, opencode, pi, orca, hermes, or unknown
- `config_path`: path to the harness config directory
- `history_path`: path to conversation history (if detectable)
- `os`: darwin, linux, or windows

If discovery fails or returns unknowns, ask the user to clarify:
- Which harness are you using?
- Where is your config stored? (Common paths below)

**Common config paths by harness**:
| Harness | macOS config path |
|---------|-------------------|
| Claude Code | `~/.claude/` |
| Cursor | `~/Library/Application Support/Cursor/` |
| Codex | `~/.codex/` |
| OpenCode | `~/.opencode/` |
| Pi | `~/.config/pi/` |
| Orca | `~/.orca/` |
| Hermes | `~/.hermes/` |

Record:
- `harness_type`: (measured)
- `config_path`: (measured or user-provided)
- `history_path`: (measured or unknown)
- `os`: (measured)

---

## 2. Config Collection

Enumerate the user's tooling. For each category, count items and estimate token load.

### 2.1 Built-in tools

List the tools available in this harness. For Claude Code these include:
Read, Write, Edit, Bash, Grep, Glob, Agent, Artifact, etc.

Count: ____
Method: measured

### 2.2 MCP servers

Check for MCP configuration. In Claude Code, look at:
- `~/.claude/settings.json` (mcpServers key)
- Project `.mcp.json` files

For each MCP server, record:
- Server name
- Tool count (if enumerable)

Total MCP servers: ____
Total MCP tools: ____
Method: measured|estimated

### 2.3 Skills / slash commands

Check for custom skills. In Claude Code, look at:
- `~/.claude/commands/` (global)
- `.claude/commands/` (project)
- `.skills/` directories
- Plugin skills

For each skill, estimate frontmatter token cost:
- Minimal (< 100 tokens): just a name and trigger
- Light (100-500 tokens): short instructions
- Medium (500-2000 tokens): detailed workflow
- Heavy (2000+ tokens): full protocol with examples

Total skills: ____
Token load estimate: ____
Method: measured|estimated

### 2.4 Hooks

Check for hooks. In Claude Code:
- `~/.claude/hooks/` (global)
- `.claude/hooks/` (project)

Count hooks by event type:
- PreToolUse: ____
- PostToolUse: ____
- UserPromptSubmit: ____
- Other: ____

Method: measured

### 2.5 CLAUDE.md / system instructions

Measure total system instruction size:
- Global CLAUDE.md: ____ lines
- Project CLAUDE.md: ____ lines
- Rules files: ____ total lines

Method: measured

---

## 3. Usage Analysis

If conversation history is accessible, sample recent sessions to categorize task types.
Do NOT read actual content - only categorize by the KIND of work.

**Task categories**:
- `code-write`: Writing new code from scratch
- `code-fix`: Debugging, fixing bugs
- `code-refactor`: Restructuring existing code
- `code-review`: Reviewing code for issues
- `test-write`: Writing tests
- `config`: Configuration, setup, tooling
- `docs`: Documentation, READMEs
- `research`: Finding information, understanding code
- `plan`: Planning, architecture, design
- `ops`: DevOps, CI/CD, deployment
- `other`: Anything else

Sample up to 20 recent conversations. For each, assign ONE primary category based on
the dominant task type.

Distribution:
```
code-write:   ____%
code-fix:     ____%
code-refactor: ____%
code-review:  ____%
test-write:   ____%
config:       ____%
docs:         ____%
research:     ____%
plan:         ____%
ops:          ____%
other:        ____%
```

Method: measured|estimated|guessed

If history is not accessible, ask the user to estimate their typical distribution.

---

## 4. Self-Assessment

Ask the user to rate themselves on three dimensions. Read the anchors aloud so they
can calibrate.

### 4.1 Throughput (1-5)

> How consistently do you complete tasks with your harness?

| Rating | Anchor |
|--------|--------|
| 1 | Rarely complete tasks - often give up or switch to manual work |
| 2 | Sometimes complete - maybe 30-50% of attempts succeed |
| 3 | Usually complete - most tasks eventually get done with effort |
| 4 | Reliably complete - 80%+ success rate on routine work |
| 5 | Consistently ship - complex multi-step work completes routinely |

Your rating: ____

### 4.2 Efficiency (1-5)

> How direct is your path from start to done?

| Rating | Anchor |
|--------|--------|
| 1 | Many retries - lots of dead ends, backtracking, re-explaining |
| 2 | Indirect - takes 2-3x longer than it "should" |
| 3 | Moderate - some iteration but reasonable progress |
| 4 | Direct - usually get good results in 1-2 attempts |
| 5 | Surgical - first attempt is usually right, minimal iteration |

Your rating: ____

### 4.3 Skill Level (1-5)

> How sophisticated is your harness usage?

| Rating | Anchor |
|--------|--------|
| 1 | Basic - mostly single-turn prompts, default settings |
| 2 | Intermediate - use context, some customization |
| 3 | Capable - multiple tools, custom instructions, workflows |
| 4 | Advanced - MCPs, hooks, custom agents, automation |
| 5 | Expert - custom tools, advanced patterns, teach others |

Your rating: ____

### 4.4 Friction points (free text)

> What slows you down or frustrates you most when using this harness?

(Record verbatim, up to 500 words)

### 4.5 Wishlist (free text)

> If you could add or change one thing about your harness, what would it be?

(Record verbatim, up to 500 words)

---

## 5. Submission

Compile all collected data into the submission payload:

```json
{
  "version": "v1",
  "timestamp": "<ISO8601>",
  "participant_id": "<pseudonymous machine ID>",
  "environment": {
    "harness_type": "...",
    "config_path": "...",
    "history_path": "...",
    "os": "..."
  },
  "config": {
    "builtin_tools": { "count": 0, "method": "measured" },
    "mcp_servers": { "count": 0, "tools": 0, "method": "..." },
    "skills": { "count": 0, "token_load": "...", "method": "..." },
    "hooks": { "pre_tool": 0, "post_tool": 0, "prompt_submit": 0, "other": 0 },
    "system_instructions": { "global_lines": 0, "project_lines": 0, "rules_lines": 0 }
  },
  "usage": {
    "task_distribution": { "code-write": 0, "code-fix": 0, "..." },
    "sample_size": 0,
    "method": "..."
  },
  "self_assessment": {
    "throughput": 0,
    "efficiency": 0,
    "skill_level": 0,
    "friction": "...",
    "wishlist": "..."
  }
}
```

Generate the pseudonymous participant ID:
```bash
echo -n "$(hostname)$(whoami)" | shasum -a 256 | cut -c1-16
```

Submit via the MCP tool if available:
```
submit_interview(payload)
```

If MCP submission is not available, display the JSON and ask the user to submit it
manually at: https://shrine.dev/interview/submit

---

## 6. Completion Checklist

Before finishing, verify:

- [ ] Discovery completed (harness type, config path, OS)
- [ ] Config enumerated (tools, MCPs, skills, hooks, system instructions)
- [ ] Usage analyzed (task distribution with method tag)
- [ ] Self-assessment collected (3 ratings + 2 free text)
- [ ] Payload submitted or displayed for manual submission

If any section is incomplete, note which and why. Partial submissions are accepted.

---

## Notes for Harness with Subagent Support

If your harness supports parallel subagents (Claude Code Agent tool, etc.), you may
fan out sections 2.1-2.5 to run concurrently for faster collection. Merge results
before proceeding to section 3.

---

## Partial Submission Handling

If the user needs to stop early or something fails:
1. Collect whatever data is complete
2. Mark incomplete sections with `"status": "incomplete"` and reason
3. Submit the partial payload - partial data is still valuable
4. Offer to resume later if the harness supports session continuity
