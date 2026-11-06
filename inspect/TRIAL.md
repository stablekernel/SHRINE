# SHRINE Inspect: trial guide

A local health check of your Claude Code setup and session history, measured against the SHRINE docs. This is a pre-release trial.

- You need macOS or Linux, Claude Code, and Node 20 or newer.
- Every command below is one block. Copy it as it is.

## Install

1. Check Node. It must print `v20` or newer.

   ```sh
   node --version
   ```

2. Download the 3 release files into a new folder. With the GitHub CLI, use `gh release download inspect-v0.1.2 -R stablekernel/SHRINE` in place of the `curl` lines.

   ```sh
   mkdir -p ~/shrine-inspect-0.1.2 && cd ~/shrine-inspect-0.1.2
   base=https://github.com/stablekernel/SHRINE/releases/download/inspect-v0.1.2
   curl -fLO "$base/shrine-inspect-0.1.2.tgz"
   curl -fLO "$base/install.sh"
   curl -fLO "$base/SHA256SUMS"
   ```

3. Check the files. On Linux, use `sha256sum -c SHA256SUMS`.

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

   Both lines must say `OK`:

   ```
   install.sh: OK
   shrine-inspect-0.1.2.tgz: OK
   ```

4. Install. Run it from the folder that holds the files.

   ```sh
   sh install.sh --skill
   ```

   - Usage: `sh install.sh [--skill] [path/to/tgz]`.
   - With no path, it uses `shrine-inspect-0.1.2.tgz` next to `install.sh`, not in your current folder.
   - It checks Node, then checks the tarball against the SHA-256 written in `install.sh`, then extracts it. A mismatch installs nothing.
   - The CLI goes to `~/.local/share/shrine-inspect/0.1.2/`, linked as `~/.local/bin/shrine-inspect`.
   - `--skill` copies the Claude Code skill to `~/.claude/skills/shrine-inspect/`. Leave it out to use the CLI only.
   - To install somewhere else, set the install folder and the link folder first:

     ```sh
     SHRINE_INSPECT_PREFIX="$HOME/opt/shrine-inspect" SHRINE_INSPECT_BIN_DIR="$HOME/bin" sh install.sh --skill
     ```

5. Put `~/.local/bin` on your PATH. Skip this if the installer did not print `Add ... to your PATH`.

   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

   - This lasts for this terminal only. To keep it, add the same line to `~/.zshrc` (macOS) or `~/.bashrc` (Linux).

6. Check the install.

   ```sh
   shrine-inspect version
   ```

   ```
   shrine-inspect 0.1.2
   ```

   - All commands: `shrine-inspect --help`.

## First run (T0, scan only)

```sh
shrine-inspect run --tier T0
```

- It stops at Gate A and asks whether to read your session history too:

  ```
  Type one of no-history, history:
  ```

- Type `history` to read your session history, or `no-history` for setup only. Then press Enter.
- To skip the question and read setup only:

  ```sh
  shrine-inspect run --tier T0 --no-history
  ```

- T0 costs no tokens. Nothing leaves your machine.

## T1 run (Pulse: adds 12 judged episodes)

```sh
shrine-inspect run --tier T1
```

- At Gate A, type `history`. T1 needs your session history.
- After the scan, Gate B shows the estimated tokens and judging minutes for your run. Nothing is sent yet.
- Gate A dates are when your session files last changed. Gate B dates are when the sampled episodes started, so they can be earlier.
- To approve T1, type `yes`. `y` is not enough. To stay at a scan only, type `T0`.

  ```
  Type yes to approve T1, or T0 for the scan only:
  ```

- Long runs in the background:

  ```sh
  shrine-inspect start --tier T1
  shrine-inspect status
  ```

  - `status` prints the exact `approve` line to type at each gate. Add `--background` to it and the run keeps going after you close the terminal.

- Or in Claude Code: ask it to run SHRINE Inspect. The skill starts a background run and tells you what to type.
- Only you answer gates, in your own terminal. The skill never answers for you.
  - The CLI takes an answer only from an interactive terminal. It cannot tell you from a tool that fakes one, so never let an agent run `approve`.
  - A choice named on the `approve` command line is confirmed only by a typed `yes`, at every gate.

## Where the reports land

- At the end, the run prints both paths:

  ```
  Report: <run folder>/report.html
  Share-safe copy: <run folder>/report.share-safe.html
  ```

- The run folder is under `~/Library/Application Support/shrine-inspect/runs/` (macOS) or `~/.local/state/shrine-inspect/runs/` (Linux).
- To keep a run apart (a trial, a test), set its own state and cache folders. Every command that reads that run needs the same two settings:

  ```sh
  export SHRINE_INSPECT_STATE_DIR="$HOME/shrine-trial/state"
  export SHRINE_INSPECT_CACHE_DIR="$HOME/shrine-trial/cache"
  shrine-inspect run --tier T0
  ```
- To print the paths again:

  ```sh
  shrine-inspect status
  ```

- Open the report on macOS (on Linux, use `xdg-open`):

  ```sh
  open "<run folder>/report.html"
  ```

## Check the share-safe copy

```sh
shrine-inspect check-share
```

- It checks the newest run's `report.share-safe.html` for your OS user, home folder, git author names and emails, project, repo, and org names, project folders, session excerpts, and absolute paths. Read-only, no network.
- To check the exact file you will send, give its path:

  ```sh
  shrine-inspect check-share "<path to report.share-safe.html>"
  ```

- A pass ends with:

  ```
  OK: nothing this check knows about is in the share-safe copy. Still read it before you send it.
  ```

- `NOT SAFE` (exit 5) lists what it found. Do not send that file. Tell the maintainer what was found, without the file.
- It cannot know every secret: secrets are removed before anything is written, so there is nothing local to compare. Read the file before you send it.

## What it reads

- Your Claude Code setup in `~/.claude/`: settings, instruction files, hooks, skills, agents, commands, plugins, memory files.
- Git data of the projects in your history: log and config, read only.
- Session logs in `~/.claude/projects/`: before Gate A, only names, sizes, and dates, plus the first 10 lines of the newest session per folder to find its folder; only the folder, entry point, and version are kept, never prompt text. The full logs only after you answer `history`.
- It writes only to its own folder: macOS `~/Library/Application Support/shrine-inspect/`, Linux `~/.local/state/shrine-inspect/`. `shrine-inspect purge` deletes it.
- One exception, at T1 only: each judge call launches Claude Code, which may update its own state and cache files (`~/.claude.json`, files under `~/.claude/`).
- It checks that it changed nothing it read. If something changed, the report shows a warning at the top.

## What it never sends

- T0: nothing leaves your machine. No network, no model calls.
- T1: 12 short episode excerpts go to your own Claude Code login, one call each, billed to your account like normal use. Secrets are removed and names, paths, and hosts are masked first.
- Each excerpt holds your messages, the start of each reply, the end of the last reply, how the episode ended (with end signals code computed, such as an open question for you), and only the instruction lines that match your corrections. Code searches all your loaded instruction files for those lines; the rest stay on your machine.
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

- A Pulse run uses tens of thousands of tokens. Gate B shows the estimate for your run before anything is sent. It includes a retry reserve and a safety margin.
- The minutes Gate B shows cover judging only, not the scan or time at the gates.
- Real time varies by machine, login, and network. The judging time limit is the only fixed number: the estimate plus 50%.
- Judging stops and asks you past the approved token limit, past that time limit (a call still running is cut off), at too many invalid answers, or at a usage limit.
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
check-share result: OK / NOT SAFE, what it found:
Anything confusing:
Share-safe report attached? yes / no
```

## Remove

1. Wait for any run to finish, then delete inspect's own folder:

   ```sh
   shrine-inspect status
   shrine-inspect purge
   ```

2. Delete the install, the link, and the skill:

   ```sh
   rm -rf ~/.local/share/shrine-inspect ~/.local/bin/shrine-inspect ~/.claude/skills/shrine-inspect
   ```
