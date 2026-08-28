#!/bin/bash
# Claude Desktop MCP installer for harness-interview
# Usage: curl -fsSL https://raw.githubusercontent.com/stablekernel/SHRINE/main/harness-interview/install.sh | bash

set -e

# Config
MCP_NAME="harness-interview"
MCP_URL="https://FUNCTION_URL_PLACEHOLDER"  # TODO: Replace after deploy

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[x]${NC} $1"; exit 1; }

# Detect OS
case "$(uname -s)" in
    Darwin) CONFIG_DIR="$HOME/Library/Application Support/Claude" ;;
    Linux)  CONFIG_DIR="$HOME/.config/claude" ;;
    *)      error "Unsupported OS: $(uname -s)" ;;
esac

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

info "Installing $MCP_NAME MCP server for Claude Desktop"

# Create config dir if needed
if [ ! -d "$CONFIG_DIR" ]; then
    info "Creating config directory: $CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"
fi

# Backup existing config
if [ -f "$CONFIG_FILE" ]; then
    BACKUP="$CONFIG_FILE.backup.$(date +%Y%m%d_%H%M%S)"
    info "Backing up existing config to: $BACKUP"
    cp "$CONFIG_FILE" "$BACKUP"
fi

# Build new MCP entry
MCP_ENTRY=$(cat <<EOF
{
  "url": "$MCP_URL",
  "auth": {
    "type": "oauth",
    "provider": "google"
  }
}
EOF
)

# Update or create config
if [ -f "$CONFIG_FILE" ]; then
    # File exists - merge MCP server entry
    if command -v jq &> /dev/null; then
        info "Updating existing config with jq"
        jq --arg name "$MCP_NAME" --argjson entry "$MCP_ENTRY" \
           '.mcpServers[$name] = $entry' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" \
           && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
    else
        warn "jq not found - checking if entry already exists"
        if grep -q "\"$MCP_NAME\"" "$CONFIG_FILE"; then
            warn "Entry exists but jq not available to update. Manual edit required."
            echo "Add this to mcpServers in $CONFIG_FILE:"
            echo "  \"$MCP_NAME\": $MCP_ENTRY"
            exit 0
        else
            warn "jq not available. Manual edit required."
            echo "Add this to mcpServers in $CONFIG_FILE:"
            echo "  \"$MCP_NAME\": $MCP_ENTRY"
            exit 0
        fi
    fi
else
    # Create new config
    info "Creating new config file"
    cat > "$CONFIG_FILE" <<EOF
{
  "mcpServers": {
    "$MCP_NAME": $MCP_ENTRY
  }
}
EOF
fi

info "Config updated: $CONFIG_FILE"

# Success message
echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart Claude Desktop"
echo "  2. You'll be prompted to authenticate with Google"
echo "  3. Ask Claude: \"Run the harness interview\""
echo ""

# Try to open OAuth URL
AUTH_URL="$MCP_URL/auth/start"
if [ "$MCP_URL" != "https://FUNCTION_URL_PLACEHOLDER" ]; then
    if command -v open &> /dev/null; then
        read -p "Open browser for OAuth? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            open "$AUTH_URL"
        fi
    elif command -v xdg-open &> /dev/null; then
        read -p "Open browser for OAuth? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            xdg-open "$AUTH_URL"
        fi
    else
        echo "Visit this URL to authenticate: $AUTH_URL"
    fi
fi
