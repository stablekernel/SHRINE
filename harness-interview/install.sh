#!/bin/bash
# MCP installer for harness-interview
# Supports: Claude Code, Claude Desktop, Cursor, Cline, Continue, OpenCode, Hermes, Pi/OMP
# Usage: curl -fsSL https://raw.githubusercontent.com/stablekernel/SHRINE/main/harness-interview/install.sh | bash

set -e

MCP_NAME="harness-interview"
MCP_URL="https://FUNCTION_URL_PLACEHOLDER"  # Replace after deploy

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

CONFIGURED=()
OS="$(uname -s)"
HAS_JQ=$(command -v jq &> /dev/null && echo 1 || echo 0)

info "Installing $MCP_NAME MCP server"

# Helper: configure JSON with jq or warn
configure_json() {
    local config="$1" name="$2" entry="$3"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    if [ "$HAS_JQ" = "1" ]; then
        if [ -f "$config" ]; then
            jq --argjson entry "$entry" '.mcpServers["'"$MCP_NAME"'"] = $entry' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        else
            mkdir -p "$(dirname "$config")"
            echo "{\"mcpServers\":{\"$MCP_NAME\":$entry}}" | jq . > "$config"
        fi
        info "Configured $name: $config"
        CONFIGURED+=("$name")
    else
        warn "jq not found. Add manually to $config"
    fi
}

# Claude Code
if [ -d "$HOME/.claude" ]; then
    info "Found Claude Code"
    configure_json "$HOME/.claude/settings.json" "Claude Code" '{"url":"'"$MCP_URL"'"}'
fi

# Claude Desktop
case "$OS" in
    Darwin) desktop_dir="$HOME/Library/Application Support/Claude" ;;
    Linux)  desktop_dir="$HOME/.config/claude" ;;
    *)      desktop_dir="" ;;
esac
if [ -n "$desktop_dir" ] && { [ -d "$desktop_dir" ] || [ -f "$desktop_dir/claude_desktop_config.json" ]; }; then
    info "Found Claude Desktop"
    mkdir -p "$desktop_dir"
    configure_json "$desktop_dir/claude_desktop_config.json" "Claude Desktop" '{"url":"'"$MCP_URL"'","auth":{"type":"oauth","provider":"google"}}'
fi

# Cursor
if [ -d "$HOME/.cursor" ]; then
    info "Found Cursor"
    configure_json "$HOME/.cursor/mcp.json" "Cursor" '{"url":"'"$MCP_URL"'"}'
fi

# Cline (VS Code extension)
case "$OS" in
    Darwin) cline_dir="$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings" ;;
    Linux)  cline_dir="$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings" ;;
    *)      cline_dir="" ;;
esac
if [ -n "$cline_dir" ] && [ -d "$(dirname "$cline_dir")" ]; then
    info "Found Cline"
    mkdir -p "$cline_dir"
    config="$cline_dir/cline_mcp_settings.json"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    if [ "$HAS_JQ" = "1" ]; then
        entry='{"url":"'"$MCP_URL"'"}'
        if [ -f "$config" ]; then
            # Cline uses mcpServers or servers key
            if jq -e '.mcpServers' "$config" &>/dev/null; then
                jq --argjson entry "$entry" '.mcpServers["'"$MCP_NAME"'"] = $entry' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
            else
                jq --argjson entry "$entry" '.servers["'"$MCP_NAME"'"] = $entry' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
            fi
        else
            echo "{\"mcpServers\":{\"$MCP_NAME\":$entry}}" | jq . > "$config"
        fi
        info "Configured Cline: $config"
        CONFIGURED+=("Cline")
    else
        warn "jq not found. Add manually to $config"
    fi
fi

# Continue.dev (drops JSON file in mcpServers directory)
continue_dir="$HOME/.continue/mcpServers"
if [ -d "$HOME/.continue" ]; then
    info "Found Continue.dev"
    mkdir -p "$continue_dir"
    config="$continue_dir/$MCP_NAME.json"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    cat > "$config" <<EOF
{
  "name": "$MCP_NAME",
  "url": "$MCP_URL",
  "transport": "sse"
}
EOF
    info "Configured Continue: $config"
    CONFIGURED+=("Continue")
fi

# OpenCode
opencode_config="$HOME/.config/opencode/opencode.json"
if [ -d "$HOME/.config/opencode" ] || [ -f "$opencode_config" ]; then
    info "Found OpenCode"
    mkdir -p "$(dirname "$opencode_config")"
    [ -f "$opencode_config" ] && cp "$opencode_config" "$opencode_config.bak.$(date +%s)"
    if [ "$HAS_JQ" = "1" ]; then
        entry='{"url":"'"$MCP_URL"'"}'
        if [ -f "$opencode_config" ]; then
            jq --argjson entry "$entry" '.mcp_servers["'"$MCP_NAME"'"] = $entry' "$opencode_config" > "$opencode_config.tmp" && mv "$opencode_config.tmp" "$opencode_config"
        else
            echo "{\"mcp_servers\":{\"$MCP_NAME\":$entry}}" | jq . > "$opencode_config"
        fi
        info "Configured OpenCode: $opencode_config"
        CONFIGURED+=("OpenCode")
    else
        warn "jq not found. Add manually to $opencode_config"
    fi
fi

# Hermes (YAML config)
hermes_config="$HOME/.hermes/config.yaml"
if [ -d "$HOME/.hermes" ] || [ -f "$hermes_config" ]; then
    info "Found Hermes"
    mkdir -p "$(dirname "$hermes_config")"
    [ -f "$hermes_config" ] && cp "$hermes_config" "$hermes_config.bak.$(date +%s)"
    if command -v yq &> /dev/null; then
        if [ -f "$hermes_config" ]; then
            yq -i ".mcp_servers.\"$MCP_NAME\".url = \"$MCP_URL\"" "$hermes_config"
        else
            echo "mcp_servers:" > "$hermes_config"
            yq -i ".mcp_servers.\"$MCP_NAME\".url = \"$MCP_URL\"" "$hermes_config"
        fi
        info "Configured Hermes: $hermes_config"
        CONFIGURED+=("Hermes")
    else
        # Fallback: append if not present
        if [ -f "$hermes_config" ] && grep -q "$MCP_NAME" "$hermes_config"; then
            warn "Hermes already has $MCP_NAME entry (yq not found for update)"
        else
            [ ! -f "$hermes_config" ] && echo "mcp_servers:" > "$hermes_config"
            cat >> "$hermes_config" <<EOF
  $MCP_NAME:
    url: "$MCP_URL"
EOF
            info "Configured Hermes: $hermes_config (appended)"
            CONFIGURED+=("Hermes")
        fi
    fi
fi

# Pi/OMP (also auto-imports from Claude Code if configured)
omp_config="$HOME/.omp/agent/mcp.json"
if [ -d "$HOME/.omp" ]; then
    info "Found Pi/OMP"
    mkdir -p "$(dirname "$omp_config")"
    [ -f "$omp_config" ] && cp "$omp_config" "$omp_config.bak.$(date +%s)"
    if [ "$HAS_JQ" = "1" ]; then
        entry='{"url":"'"$MCP_URL"'"}'
        if [ -f "$omp_config" ]; then
            jq --argjson entry "$entry" '.["'"$MCP_NAME"'"] = $entry' "$omp_config" > "$omp_config.tmp" && mv "$omp_config.tmp" "$omp_config"
        else
            echo "{\"$MCP_NAME\":$entry}" | jq . > "$omp_config"
        fi
        info "Configured Pi/OMP: $omp_config"
        CONFIGURED+=("Pi/OMP")
    else
        warn "jq not found. Add manually to $omp_config"
    fi
fi

echo ""
if [ ${#CONFIGURED[@]} -gt 0 ]; then
    echo -e "${GREEN}Done!${NC} Configured ${#CONFIGURED[@]} harness(es):"
    for h in "${CONFIGURED[@]}"; do
        echo "  - $h"
    done
    echo ""
    echo "Next steps:"
    echo "  1. Restart your harness"
    echo "  2. Ask: \"Run the harness interview\""
else
    echo -e "${YELLOW}No supported harnesses found.${NC}"
    echo "Supported: Claude Code, Claude Desktop, Cursor, Cline, Continue, OpenCode, Hermes, Pi/OMP"
    echo ""
    echo "Manual setup: add to your MCP config:"
    echo "  \"$MCP_NAME\": {\"url\": \"$MCP_URL\"}"
fi
