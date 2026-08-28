#!/usr/bin/env bash
#
# discover.sh - Detect AI coding harness type and locate config/history paths
#
# Usage: bash discover.sh
# Output: JSON with harness_type, config_path, history_path, history_stats, os
#
# Supports: Claude Code, Claude Desktop, Cursor, Codex, OpenCode, Pi/OMP, Orca,
#           Hermes, Cline, Continue, Aider
# Platform: macOS (darwin) and Linux - Windows returns os but may miss paths
#

set -euo pipefail

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Darwin)  echo "darwin" ;;
        Linux)   echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)       echo "unknown" ;;
    esac
}

# Check if a process is running (exact match to avoid false positives)
process_running() {
    pgrep -x "$1" > /dev/null 2>&1 || pgrep -f "^$1\$" > /dev/null 2>&1
}

# Check if a directory exists and is non-empty
dir_exists() {
    [[ -d "$1" ]] && [[ -n "$(ls -A "$1" 2>/dev/null)" ]]
}

# Check if a file exists
file_exists() {
    [[ -f "$1" ]]
}

# JSON-escape a string (handles quotes, backslashes, newlines)
json_escape() {
    local str="$1"
    str="${str//\\/\\\\}"   # Escape backslashes first
    str="${str//\"/\\\"}"   # Escape quotes
    str="${str//$'\n'/\\n}" # Escape newlines
    str="${str//$'\r'/\\r}" # Escape carriage returns
    str="${str//$'\t'/\\t}" # Escape tabs
    printf '%s' "$str"
}

# Detect harness type - check all known harnesses
detect_harness() {
    local harness="unknown"

    # Check running processes first (most reliable)
    if process_running "claude"; then
        harness="claude-code"
    elif process_running "cursor"; then
        harness="cursor"
    elif process_running "codex"; then
        harness="codex"
    elif process_running "opencode"; then
        harness="opencode"
    elif process_running "pi-ai" || process_running "omp"; then
        harness="pi"
    elif process_running "orca"; then
        harness="orca"
    elif process_running "hermes"; then
        harness="hermes"
    elif process_running "cline"; then
        harness="cline"
    elif process_running "continue"; then
        harness="continue"
    elif process_running "aider"; then
        harness="aider"
    fi

    # If no process found, check config directories (order matters - check most specific first)
    if [[ "$harness" == "unknown" ]]; then
        local os
        os=$(detect_os)

        if dir_exists "$HOME/.claude"; then
            harness="claude-code"
        elif [[ "$os" == "darwin" ]] && dir_exists "$HOME/Library/Application Support/Claude"; then
            harness="claude-desktop"
        elif [[ "$os" == "linux" ]] && dir_exists "$HOME/.config/claude"; then
            harness="claude-desktop"
        elif dir_exists "$HOME/.cursor" || dir_exists "$HOME/Library/Application Support/Cursor"; then
            harness="cursor"
        elif dir_exists "$HOME/.codex"; then
            harness="codex"
        elif dir_exists "$HOME/.config/opencode"; then
            harness="opencode"
        elif dir_exists "$HOME/.omp"; then
            harness="pi"
        elif dir_exists "$HOME/.orca"; then
            harness="orca"
        elif dir_exists "$HOME/.hermes"; then
            harness="hermes"
        elif dir_exists "$HOME/.cline"; then
            harness="cline"
        elif dir_exists "$HOME/.continue"; then
            harness="continue"
        elif file_exists ".aider.conf" || file_exists ".aider.chat.history.md"; then
            harness="aider"
        fi
    fi

    echo "$harness"
}

# Get config path for harness
get_config_path() {
    local harness="$1"
    local os="$2"

    case "$harness" in
        claude-code)
            echo "$HOME/.claude/settings.json"
            ;;
        claude-desktop)
            if [[ "$os" == "darwin" ]]; then
                echo "$HOME/Library/Application Support/Claude/"
            elif [[ "$os" == "linux" ]]; then
                echo "$HOME/.config/claude/"
            else
                echo ""
            fi
            ;;
        cursor)
            if [[ "$os" == "darwin" ]]; then
                echo "$HOME/.cursor/mcp.json"
            elif [[ "$os" == "linux" ]]; then
                echo "$HOME/.config/Cursor/"
            else
                echo ""
            fi
            ;;
        codex)
            echo "$HOME/.codex/"
            ;;
        opencode)
            echo "$HOME/.config/opencode/"
            ;;
        pi)
            echo "$HOME/.omp/"
            ;;
        orca)
            echo "$HOME/.orca/"
            ;;
        hermes)
            echo "$HOME/.hermes/config.yaml"
            ;;
        cline)
            echo "$HOME/.cline/"
            ;;
        continue)
            echo "$HOME/.continue/config.json"
            ;;
        aider)
            # Aider uses project-local config
            if file_exists ".aider.conf"; then
                echo ".aider.conf"
            else
                echo ""
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

# Get history path for harness
get_history_path() {
    local harness="$1"
    local os="$2"

    case "$harness" in
        claude-code)
            # Claude Code stores history as JSONL in project directories with UUID chain
            if dir_exists "$HOME/.claude/projects"; then
                echo "$HOME/.claude/projects/"
            else
                echo ""
            fi
            ;;
        claude-desktop)
            if [[ "$os" == "darwin" ]]; then
                echo "$HOME/Library/Application Support/Claude/"
            elif [[ "$os" == "linux" ]]; then
                echo "$HOME/.config/claude/"
            else
                echo ""
            fi
            ;;
        cursor)
            if [[ "$os" == "darwin" ]]; then
                local cursor_storage="$HOME/Library/Application Support/Cursor/User/workspaceStorage"
                if dir_exists "$cursor_storage"; then
                    echo "$cursor_storage"
                else
                    echo ""
                fi
            else
                echo ""
            fi
            ;;
        codex)
            if dir_exists "$HOME/.codex/history"; then
                echo "$HOME/.codex/history/"
            else
                echo ""
            fi
            ;;
        opencode)
            # OpenCode commands stored in config dir
            if dir_exists "$HOME/.config/opencode/commands"; then
                echo "$HOME/.config/opencode/commands/"
            else
                echo ""
            fi
            ;;
        pi)
            # Pi/OMP stores sessions as JSONL tree with parentId
            if dir_exists "$HOME/.omp/agent/sessions"; then
                echo "$HOME/.omp/agent/sessions/"
            else
                echo ""
            fi
            ;;
        orca)
            # Orca stores history in SQLite
            if file_exists "$HOME/.orca/orca.db"; then
                echo "$HOME/.orca/orca.db"
            else
                echo ""
            fi
            ;;
        hermes)
            # Hermes stores sessions as JSONL
            if dir_exists "$HOME/.hermes/sessions"; then
                echo "$HOME/.hermes/sessions/"
            else
                echo ""
            fi
            ;;
        cline)
            # Cline v4+ stores history in same dir as config
            if dir_exists "$HOME/.cline"; then
                echo "$HOME/.cline/"
            else
                echo ""
            fi
            ;;
        continue)
            if dir_exists "$HOME/.continue"; then
                echo "$HOME/.continue/"
            else
                echo ""
            fi
            ;;
        aider)
            # Aider stores history as project-local markdown
            if file_exists ".aider.chat.history.md"; then
                echo ".aider.chat.history.md"
            else
                echo ""
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

# Get history stats from history path
get_history_stats() {
    local history_path="$1"
    local harness="$2"

    local session_count=0
    local total_size_kb=0
    local oldest_session=""
    local newest_session=""

    if [[ -z "$history_path" ]]; then
        printf '{"session_count": 0, "total_size_kb": 0, "oldest_session": "", "newest_session": ""}'
        return
    fi

    # Handle SQLite databases (Orca)
    if [[ "$history_path" == *.db ]] && file_exists "$history_path"; then
        total_size_kb=$(du -k "$history_path" 2>/dev/null | cut -f1 || echo 0)
        # Can't easily count sessions without sqlite3
        printf '{"session_count": -1, "total_size_kb": %d, "oldest_session": "", "newest_session": "", "format": "sqlite"}' "$total_size_kb"
        return
    fi

    # Handle single-file history (Aider)
    if [[ -f "$history_path" ]]; then
        total_size_kb=$(du -k "$history_path" 2>/dev/null | cut -f1 || echo 0)
        oldest_session=$(stat -f "%Sm" -t "%Y-%m-%d" "$history_path" 2>/dev/null || stat -c "%y" "$history_path" 2>/dev/null | cut -d' ' -f1 || echo "")
        newest_session="$oldest_session"
        printf '{"session_count": 1, "total_size_kb": %d, "oldest_session": "%s", "newest_session": "%s", "format": "single_file"}' \
            "$total_size_kb" "$(json_escape "$oldest_session")" "$(json_escape "$newest_session")"
        return
    fi

    # Handle directory-based history
    if [[ -d "$history_path" ]]; then
        # Count session files based on harness type
        case "$harness" in
            claude-code)
                # Claude Code: count project directories (each is a session context)
                session_count=$(find "$history_path" -maxdepth 2 -type d 2>/dev/null | wc -l | tr -d ' ')
                ;;
            pi)
                # Pi: count JSONL session files
                session_count=$(find "$history_path" -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
                ;;
            hermes)
                # Hermes: count JSONL session files
                session_count=$(find "$history_path" -name "*.jsonl" -type f 2>/dev/null | wc -l | tr -d ' ')
                ;;
            *)
                # Generic: count all files
                session_count=$(find "$history_path" -type f 2>/dev/null | wc -l | tr -d ' ')
                ;;
        esac

        # Calculate total size
        total_size_kb=$(du -sk "$history_path" 2>/dev/null | cut -f1 || echo 0)

        # Get oldest and newest file dates
        if command -v stat >/dev/null 2>&1; then
            # macOS stat
            if [[ "$(uname -s)" == "Darwin" ]]; then
                oldest_session=$(find "$history_path" -type f -exec stat -f "%m %Sm" -t "%Y-%m-%d" {} \; 2>/dev/null | sort -n | head -1 | cut -d' ' -f2 || echo "")
                newest_session=$(find "$history_path" -type f -exec stat -f "%m %Sm" -t "%Y-%m-%d" {} \; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2 || echo "")
            else
                # Linux stat
                oldest_session=$(find "$history_path" -type f -printf "%T+ %p\n" 2>/dev/null | sort | head -1 | cut -d'+' -f1 || echo "")
                newest_session=$(find "$history_path" -type f -printf "%T+ %p\n" 2>/dev/null | sort -r | head -1 | cut -d'+' -f1 || echo "")
            fi
        fi

        printf '{"session_count": %d, "total_size_kb": %d, "oldest_session": "%s", "newest_session": "%s", "format": "directory"}' \
            "$session_count" "$total_size_kb" "$(json_escape "$oldest_session")" "$(json_escape "$newest_session")"
        return
    fi

    # Fallback - no readable history
    printf '{"session_count": 0, "total_size_kb": 0, "oldest_session": "", "newest_session": ""}'
}

# Main
main() {
    local os
    local harness
    local config_path
    local history_path
    local history_stats

    os=$(detect_os)
    harness=$(detect_harness)
    config_path=$(get_config_path "$harness" "$os")
    history_path=$(get_history_path "$harness" "$os")
    history_stats=$(get_history_stats "$history_path" "$harness")

    # Validate config path exists (file or directory)
    if [[ -n "$config_path" ]]; then
        if [[ ! -f "$config_path" ]] && [[ ! -d "$config_path" ]]; then
            config_path=""
        fi
    fi

    # Validate history path exists
    if [[ -n "$history_path" ]]; then
        if [[ ! -f "$history_path" ]] && [[ ! -d "$history_path" ]]; then
            history_path=""
            history_stats='{"session_count": 0, "total_size_kb": 0, "oldest_session": "", "newest_session": ""}'
        fi
    fi

    # Output JSON (escaped to handle special characters in paths)
    printf '{\n'
    printf '  "harness_type": "%s",\n' "$(json_escape "$harness")"
    printf '  "config_path": "%s",\n' "$(json_escape "$config_path")"
    printf '  "history_path": "%s",\n' "$(json_escape "$history_path")"
    printf '  "history_stats": %s,\n' "$history_stats"
    printf '  "os": "%s"\n' "$(json_escape "$os")"
    printf '}\n'
}

main "$@"
