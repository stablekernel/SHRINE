# SHRINE Inspect: trial guide

A local health check of your Claude Code setup and session history, measured against the SHRINE docs. This is a pre-release trial.

## Install

1. You need macOS or Linux, Claude Code, and Node 20 or newer (`node --version`).
2. Put the 3 release files in one folder: `shrine-inspect-0.1.0.tgz`, `install.sh`, `SHA256SUMS`. For the trial, the maintainer gives them to you.
3. Check the files: `shasum -a 256 -c SHA256SUMS` (Linux: `sha256sum -c SHA256SUMS`). Both lines must say `OK`.
4. Install: `sh install.sh --skill`
   - It checks Node, then checks the tarball against the SHA-256 written in `install.sh`, then extracts it.
   - The CLI goes to `~/.local/share/shrine-inspect/0.1.0/`, linked as `~/.local/bin/shrine-inspect`.
   - `--skill` copies the Claude Code skill to `~/.claude/skills/shrine-inspect/`. Leave it out to use the CLI only.
5. Check: `shrine-inspect version`

## Run

- In your terminal: `shrine-inspect run --tier T0` (scan only), or `--tier T1` (Pulse: adds 12 judged episodes).
- Or in Claude Code: ask it to run SHRINE Inspect. The skill starts a background run and tells you what to type.
- Inspect stops at gates. Only you answer them, in your own terminal. The skill never answers for you.
  - The CLI takes an answer only from an interactive terminal. It cannot tell you from a tool that fakes one, so never let an agent run `approve`.
  - Gate A: read your session history too, or not.
  - Gate B (T1 only): judging, with its token and time estimate. T0 is pre-selected; T1 needs a typed `yes`.
- Long runs: `shrine-inspect start --tier T1`, then `shrine-inspect status`. Add `--background` to an `approve` command and the run keeps going after you close the terminal.

## What it reads

- Your Claude Code setup in `~/.claude/`: settings, instruction files, hooks, skills, agents, commands, plugins, memory files.
- Git data of the projects in your history: log and config, read only.
- Session logs in `~/.claude/projects/`: before Gate A, only names, sizes, and dates, plus the first 10 lines of the newest session per folder to find its folder; only the folder, entry point, and version are kept, never prompt text. The full logs only after you answer `history`.
- It writes only to its own folder: macOS `~/Library/Application Support/shrine-inspect/`, Linux `~/.local/state/shrine-inspect/`. `shrine-inspect purge` deletes it.
- It checks that it changed nothing it read. If something changed, the report shows a warning at the top.

## What it never sends

- T0: nothing leaves your machine. No network, no model calls.
- T1: 12 short episode excerpts go to your own Claude Code login, one call each, billed to your account like normal use. Secrets are removed and names, paths, and hosts are masked first.
- Nothing goes to SHRINE, Stable Kernel, or any other service. No telemetry.

## Read the report

- `report.html` is for you. Open it in a browser.
- `report.share-safe.html` masks names, paths, and hosts and drops session excerpts. Share only this one.
- "Start with" is the one change to try first.
- T1 findings are candidates, not facts: the judge's accuracy is not measured yet.
- Every T1 finding shows N: the judged episodes, sessions, and repos behind it. A small N is a weak signal.
- Pattern counts (correction candidates, done claims) are appendix numbers only, never findings.
- There is no score or grade, by design.

## What T1 costs

- Measured on one real run: about 54K tokens and 41 seconds for 12 episodes.
- Gate B shows the estimate before you say yes, usually 59K to 84K tokens. It includes a retry reserve and a safety margin.
- Judging stops and asks you past the approved token limit, past the time estimate plus 50%, at too many invalid answers, or at a usage limit.
- T0 costs no tokens.

## Send feedback

No network: copy this block, fill it in, and send it to the maintainer in any way you like. Attach only the share-safe report, never `report.html`.

```text
SHRINE Inspect trial feedback
Version (shrine-inspect version):
OS and Node version:
Tier: T0 / T1
Minutes from install to report:
Install worked the first time? yes / no, what failed:
Gate prompts clear? yes / no, which one:
"Start with" useful? yes / no, why:
A finding that was wrong, and why:
A finding that was right and new to you:
T1 tokens: Gate B estimate / used (report footer):
Anything confusing:
Share-safe report attached? yes / no
```

## Remove

1. Wait for any run to finish (`shrine-inspect status`), then `shrine-inspect purge`
2. `rm -rf ~/.local/share/shrine-inspect ~/.local/bin/shrine-inspect ~/.claude/skills/shrine-inspect`
