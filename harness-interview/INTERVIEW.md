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
> usage metrics derived from history files, and your self-assessment ratings. No actual
> code, file paths, or conversation content.
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
- `harness_type`: claude-code, claude-desktop, cursor, codex, opencode, pi, orca, hermes, cline, continue, aider, or unknown
- `config_path`: path to the harness config file or directory
- `history_path`: path to conversation history
- `history_stats`: object with session_count, total_size_kb, oldest_session, newest_session
- `os`: darwin, linux, or windows

If discovery fails or returns unknowns, ask the user to clarify:
- Which harness are you using?
- Where is your config stored? (Common paths below)

**Common paths by harness**:
| Harness | Config path | History path |
|---------|-------------|--------------|
| Claude Code | `~/.claude/settings.json` | `~/.claude/projects/*/` (JSONL with UUID chain) |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/` | same |
| Claude Desktop (Linux) | `~/.config/claude/` | same |
| Cursor | `~/.cursor/mcp.json` | `~/Library/.../Cursor/User/workspaceStorage/` |
| Codex | `~/.codex/` | `~/.codex/history/` |
| OpenCode | `~/.config/opencode/` | `~/.config/opencode/commands/` |
| Pi/OMP | `~/.omp/` | `~/.omp/agent/sessions/` (JSONL tree with parentId) |
| Orca | `~/.orca/` | `~/.orca/orca.db` (SQLite) |
| Hermes | `~/.hermes/config.yaml` | `~/.hermes/sessions/` (JSONL) |
| Cline | `~/.cline/` (v4+) | same (JSONL) |
| Continue | `~/.continue/config.json` | `~/.continue/` |
| Aider | `.aider.conf` (project-local) | `.aider.chat.history.md` |

Record:
- `harness_type`: (measured)
- `config_path`: (measured or user-provided)
- `history_path`: (measured or unknown)
- `history_stats`: (measured)
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

## 3. History Analysis

If conversation history is accessible (history_path not empty), analyze it to derive
usage metrics. This section uses SAMPLING, not exhaustive reads.

### 3.1 Sampling Approach

**IMPORTANT**: Do not read full conversation content. Extract metadata only.

Sampling rules:
- Sample LAST 20 SESSIONS maximum
- Extract: timestamps, turn counts, message lengths (word count buckets)
- Categorize by keyword/pattern matching, NOT semantic analysis
- Report `"method": "measured"` when actually counted from files
- Report `"method": "estimated"` when extrapolated from partial data

For each harness type, history files have different structures:
- **JSONL files** (Claude Code, Pi, Hermes, Cline): Parse line-by-line, extract message fields
- **SQLite** (Orca): Query metadata tables only, avoid message content
- **Markdown** (Aider): Count turn separators (e.g., `---` or `####`)

### 3.2 Usage Metrics (derive from history files)

**Sessions per week**: Count sessions with timestamps in last 4 weeks, divide by 4
```
sessions_per_week: ____
method: measured|estimated
```

**Average session duration**: From first to last message timestamp per session
```
avg_session_duration_minutes: ____
method: measured|estimated|unavailable
```

**Average turns per session**: Count messages in session files, divide by session count
```
avg_turns_per_session: ____
method: measured|estimated
```

**Task type distribution**: Categorize by keyword patterns in first message or session title

Keyword patterns:
| Category | Match patterns (case-insensitive) |
|----------|-----------------------------------|
| code-write | "create", "implement", "build", "add", "new", "scaffold" |
| code-fix | "fix", "bug", "error", "broken", "failing", "crash" |
| code-refactor | "refactor", "clean", "improve", "restructure", "simplify" |
| code-review | "review", "check", "audit", "look at" |
| test-write | "test", "spec", "coverage", "assert" |
| config | "config", "setup", "install", "env", "CI", "deploy" |
| docs | "doc", "readme", "comment", "explain" |
| research | "find", "where", "what is", "how does", "understand" |
| plan | "plan", "design", "architect", "approach" |
| ops | "devops", "pipeline", "deploy", "monitor" |

```
task_distribution:
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

sample_size: ____
method: measured|estimated|guessed
```

### 3.3 Efficiency Metrics

**Retry rate**: Similar prompts in sequence (same session, edit distance < 30%)
```
retry_rate: ____% (of sessions with at least one retry)
method: measured|estimated|unavailable
```

**Context reset rate**: New sessions started vs. continued (fork/resume)
```
context_reset_rate: ____% (new / total)
method: measured|estimated
```

**Tool invocation patterns**: Which tools appear most in history (if visible)
```
top_tools:
  1. ____ (___%)
  2. ____ (___%)
  3. ____ (___%)
method: measured|unavailable
```

### 3.4 Behavioral Patterns

**Prompt length distribution**: Word count buckets
```
prompt_length:
  short (<50 words):   ____%
  medium (50-200):     ____%
  long (>200 words):   ____%
method: measured|estimated
```

**Model switching**: If history shows model changes (harness-dependent)
```
model_switching: yes|no|unavailable
primary_model: ____
method: measured
```

**Branching rate**: For Pi/OMP, how often /fork or /tree used
```
branching_rate: ____% (sessions with branches)
method: measured|unavailable
```

---

## 4. Self-Assessment

Ask the user to rate themselves on three dimensions. Read the anchors aloud so they
can calibrate.

**If history analysis completed**: Suggest ratings based on observed metrics, but let
the user adjust. Format: "Based on [metric], I'd suggest [rating]. Does that match
your experience?"

| Metric observed | Suggested throughput | Suggested efficiency | Suggested skill |
|-----------------|---------------------|----------------------|-----------------|
| sessions/week > 20, retry_rate < 10% | 4-5 | 4-5 | - |
| avg_turns > 50, duration > 60min | 3-4 (complex work) | - | 3-4 |
| MCP servers > 5, hooks > 3 | - | - | 4-5 |
| retry_rate > 30% | 2-3 | 2 | - |
| context_reset_rate > 80% | - | 2-3 | 2-3 |

### 4.1 Throughput (1-5)

> How consistently do you complete tasks with your harness?

| Rating | Anchor |
|--------|--------|
| 1 | Rarely complete tasks - often give up or switch to manual work |
| 2 | Sometimes complete - maybe 30-50% of attempts succeed |
| 3 | Usually complete - most tasks eventually get done with effort |
| 4 | Reliably complete - 80%+ success rate on routine work |
| 5 | Consistently ship - complex multi-step work completes routinely |

Suggested rating (from history): ____
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

Suggested rating (from history): ____
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

Suggested rating (from history): ____
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
  "version": "v2",
  "timestamp": "<ISO8601>",
  "participant_id": "<pseudonymous machine ID>",
  "environment": {
    "harness_type": "...",
    "config_path": "...",
    "history_path": "...",
    "history_stats": {
      "session_count": 0,
      "total_size_kb": 0,
      "oldest_session": "YYYY-MM-DD",
      "newest_session": "YYYY-MM-DD"
    },
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
    "sessions_per_week": 0,
    "avg_session_duration_minutes": 0,
    "avg_turns_per_session": 0,
    "task_distribution": { "code-write": 0, "code-fix": 0, "..." },
    "sample_size": 0,
    "method": "..."
  },
  "efficiency": {
    "retry_rate": 0,
    "context_reset_rate": 0,
    "top_tools": ["...", "...", "..."],
    "method": "..."
  },
  "behavior": {
    "prompt_length": { "short": 0, "medium": 0, "long": 0 },
    "model_switching": false,
    "primary_model": "...",
    "branching_rate": 0,
    "method": "..."
  },
  "self_assessment": {
    "throughput": { "suggested": 0, "actual": 0 },
    "efficiency": { "suggested": 0, "actual": 0 },
    "skill_level": { "suggested": 0, "actual": 0 },
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

- [ ] Discovery completed (harness type, config path, history stats, OS)
- [ ] Config enumerated (tools, MCPs, skills, hooks, system instructions)
- [ ] History analyzed (usage metrics, efficiency metrics, behavioral patterns) OR marked unavailable
- [ ] Self-assessment collected (3 ratings with suggested values + 2 free text)
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

---

## History Format Reference

For implementers parsing history files:

### Claude Code (JSONL)
```
~/.claude/projects/<encoded-path>/*/
  - conversations/*.jsonl (one line per message)
  - Line format: {"type":"...", "message":{...}, "timestamp":"..."}
```

### Pi/OMP (JSONL tree)
```
~/.omp/agent/sessions/
  - *.jsonl (one file per session)
  - Line format: {"id":"...", "parentId":"...", "content":"...", "timestamp":"..."}
  - parentId links to parent message (for branches/forks)
```

### Orca (SQLite)
```
~/.orca/orca.db
  - Table: conversations (id, created_at, updated_at)
  - Table: messages (id, conversation_id, role, created_at)
  - Query metadata only, avoid content column
```

### Hermes (JSONL)
```
~/.hermes/sessions/
  - *.jsonl (one file per session)
  - Line format: {"role":"...", "content":"...", "timestamp":"..."}
```

### Aider (Markdown)
```
.aider.chat.history.md (project-local)
  - Turn separator: #### or ---
  - Count separators for turn count
  - File modification date for timestamps
```
