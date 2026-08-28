#!/bin/bash
# MCP installer for harness-interview
# Supports: Claude Code, Claude Desktop, Cursor
# Usage: curl -fsSL https://raw.githubusercontent.com/stablekernel/SHRINE/main/harness-interview/install.sh | bash

set -e

MCP_NAME="harness-interview"
MCP_URL="https://FUNCTION_URL_PLACEHOLDER"  # Replace after deploy

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

CONFIGURED=0
OS="$(uname -s)"

info "Installing $MCP_NAME MCP server"

# Claude Code
if [ -d "$HOME/.claude" ]; then
    info "Found Claude Code"
    config="$HOME/.claude/settings.json"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    if command -v jq &> /dev/null; then
        if [ -f "$config" ]; then
            jq --arg url "$MCP_URL" '.mcpServers["harness-interview"] = {"url": $url}' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        else
            echo "{\"mcpServers\":{\"harness-interview\":{\"url\":\"$MCP_URL\"}}}" | jq . > "$config"
        fi
        info "Configured Claude Code: $config"
        CONFIGURED=$((CONFIGURED + 1))
    else
        warn "jq not found. Add manually: mcpServers.harness-interview.url = $MCP_URL"
    fi
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
    config="$desktop_dir/claude_desktop_config.json"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    entry='{"url":"'"$MCP_URL"'","auth":{"type":"oauth","provider":"google"}}'
    if command -v jq &> /dev/null; then
        if [ -f "$config" ]; then
            jq --argjson entry "$entry" '.mcpServers["harness-interview"] = $entry' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        else
            echo "{\"mcpServers\":{\"harness-interview\":$entry}}" | jq . > "$config"
        fi
        info "Configured Claude Desktop: $config"
        CONFIGURED=$((CONFIGURED + 1))
    else
        warn "jq not found. Add manually to $config"
    fi
fi

# Cursor
if [ -d "$HOME/.cursor" ]; then
    info "Found Cursor"
    config="$HOME/.cursor/mcp.json"
    [ -f "$config" ] && cp "$config" "$config.bak.$(date +%s)"
    if command -v jq &> /dev/null; then
        if [ -f "$config" ]; then
            jq --arg url "$MCP_URL" '.mcpServers["harness-interview"] = {"url": $url}' "$config" > "$config.tmp" && mv "$config.tmp" "$config"
        else
            mkdir -p "$HOME/.cursor"
            echo "{\"mcpServers\":{\"harness-interview\":{\"url\":\"$MCP_URL\"}}}" | jq . > "$config"
        fi
        info "Configured Cursor: $config"
        CONFIGURED=$((CONFIGURED + 1))
    else
        warn "jq not found. Add manually to $config"
    fi
fi

echo ""
if [ $CONFIGURED -gt 0 ]; then
    echo -e "${GREEN}Done!${NC} Configured $CONFIGURED harness(es)."
    echo ""
    echo "Next steps:"
    echo "  1. Restart your harness"
    echo "  2. Ask: \"Run the harness interview\""
else
    echo -e "${YELLOW}No supported harnesses found.${NC}"
    echo "Supported: Claude Code, Claude Desktop, Cursor"
    echo ""
    echo "Manual setup: add to your MCP config:"
    echo "  \"harness-interview\": {\"url\": \"$MCP_URL\"}"
fi
