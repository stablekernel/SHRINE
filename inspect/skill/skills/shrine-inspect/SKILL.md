---
name: shrine-inspect
description: Run SHRINE Inspect, a local, read-only health check of this AI coding setup and its session history against the SHRINE docs. Use when the user asks to inspect, audit, or health-check their setup or their sessions with SHRINE.
allowed-tools: Bash(node --version), Bash(shrine-inspect version:*), Bash(shrine-inspect start:*), Bash(shrine-inspect status:*)
---

# SHRINE Inspect

Skill version: 0.1.4

This skill only starts the `shrine-inspect` CLI and watches it. The CLI does every read, every gate, and every judge call.

## Rules

- Never answer a gate for the user. Gates are answered only by the user, typed in their own terminal.
- Never type, pipe, or send an answer into the CLI. Never run any command that is not in the steps below.
- Never open session logs, files in the run folder, or the report in this conversation. Tell the user only what `status` prints.
- Never judge, score, or summarize the user's sessions yourself.
- On any error, show the CLI's message and hint as printed, then stop.

## Steps

1. Check Node. Run:

   ```bash
   node --version
   ```

   If the major version is below 20, stop and say: "SHRINE Inspect needs Node 20 or newer."

2. Check the CLI. Run:

   ```bash
   shrine-inspect version --skill-version 0.1.4
   ```

   If the command is not found, or it stops with `E_VERSION`, stop. Tell the user to install the CLI and this skill from the same release (see TRIAL.md in the release).

3. Start a run in the background. Use `--tier T1` only when the user asked for judging ("Pulse"); else use `--tier T0`. Always pass `--tier`: without it, `start` stops with `E_TIER_REQUIRED`. Session id: `${CLAUDE_SESSION_ID}`. If that id is empty or still shows as a placeholder, leave out `--session-id` and its value. Never leave `--session-id` with nothing after it.

   ```bash
   shrine-inspect start --tier T0 --session-id ${CLAUDE_SESSION_ID} --skill-version 0.1.4 --json
   ```

   Keep the `run_id` from the output.

4. Watch the run. Run this about every 15 seconds while the state is `running`:

   ```bash
   shrine-inspect status <run_id> --skill-version 0.1.4 --json
   ```

   - `running`: give the user one short line with the phase. Check again.
   - `gate`: show the user the `next` line exactly as printed. Say: "Inspect is waiting for your answer. Run that line in your own terminal, not here. Tell me when you have answered." Do not check again until the user says so.
   - `done`: give the user the `report` and `share_safe` paths. Say: "Open the report in your browser. Share only the share-safe copy."
   - `died` or `stopped`: show the user the `next` line. The user runs it in their own terminal.

## Cost

- T0 makes no model calls.
- T1 shows its token and time estimate at Gate B, in the user's terminal. Do not restate or approve it here.
