#!/usr/bin/env bash
#
# discover.sh - Detect AI coding harness type and locate config/history paths
#
# Usage: bash discover.sh
# Output: JSON with harness_type, config_path, history_path, os
#
# Supports: Claude Code, Cursor, Codex, OpenCode, Pi, Orca, Hermes
# Platform: macOS (darwin) - other platforms return os but may miss paths
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

# Detect harness type
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
    elif process_running "pi-ai"; then
        harness="pi"
    elif process_running "orca"; then
        harness="orca"
    elif process_running "hermes"; then
        harness="hermes"
    fi

    # If no process found, check config directories
    if [[ "$harness" == "unknown" ]]; then
        if dir_exists "$HOME/.claude"; then
            harness="claude-code"
        elif dir_exists "$HOME/Library/Application Support/Cursor"; then
            harness="cursor"
        elif dir_exists "$HOME/.codex"; then
            harness="codex"
        elif dir_exists "$HOME/.opencode"; then
            harness="opencode"
        elif dir_exists "$HOME/.config/pi"; then
            harness="pi"
        elif dir_exists "$HOME/.orca"; then
            harness="orca"
        elif dir_exists "$HOME/.hermes"; then
            harness="hermes"
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
            echo "$HOME/.claude"
            ;;
        cursor)
            if [[ "$os" == "darwin" ]]; then
                echo "$HOME/Library/Application Support/Cursor"
            elif [[ "$os" == "linux" ]]; then
                echo "$HOME/.config/Cursor"
            else
                echo ""
            fi
            ;;
        codex)
            echo "$HOME/.codex"
            ;;
        opencode)
            echo "$HOME/.opencode"
            ;;
        pi)
            echo "$HOME/.config/pi"
            ;;
        orca)
            echo "$HOME/.orca"
            ;;
        hermes)
            echo "$HOME/.hermes"
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
    local config_path="$3"

    case "$harness" in
        claude-code)
            # Claude Code stores history in projects or a central location
            if dir_exists "$HOME/.claude/projects"; then
                echo "$HOME/.claude/projects"
            else
                echo ""
            fi
            ;;
        cursor)
            # Cursor stores in workspaceStorage
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
                echo "$HOME/.codex/history"
            else
                echo ""
            fi
            ;;
        opencode)
            if dir_exists "$HOME/.opencode/sessions"; then
                echo "$HOME/.opencode/sessions"
            else
                echo ""
            fi
            ;;
        pi)
            if dir_exists "$HOME/.config/pi/history"; then
                echo "$HOME/.config/pi/history"
            else
                echo ""
            fi
            ;;
        orca)
            if dir_exists "$HOME/.orca/conversations"; then
                echo "$HOME/.orca/conversations"
            else
                echo ""
            fi
            ;;
        hermes)
            if dir_exists "$HOME/.hermes/history"; then
                echo "$HOME/.hermes/history"
            else
                echo ""
            fi
            ;;
        *)
            echo ""
            ;;
    esac
}

# Main
main() {
    local os
    local harness
    local config_path
    local history_path

    os=$(detect_os)
    harness=$(detect_harness)
    config_path=$(get_config_path "$harness" "$os")
    history_path=$(get_history_path "$harness" "$os" "$config_path")

    # Validate paths exist
    if [[ -n "$config_path" ]] && ! dir_exists "$config_path"; then
        config_path=""
    fi

    if [[ -n "$history_path" ]] && ! dir_exists "$history_path"; then
        history_path=""
    fi

    # Output JSON (escaped to handle special characters in paths)
    printf '{\n'
    printf '  "harness_type": "%s",\n' "$(json_escape "$harness")"
    printf '  "config_path": "%s",\n' "$(json_escape "$config_path")"
    printf '  "history_path": "%s",\n' "$(json_escape "$history_path")"
    printf '  "os": "%s"\n' "$(json_escape "$os")"
    printf '}\n'
}

main "$@"
