#!/usr/bin/env bash

# Install script for skills
# Installs the skill either globally for Claude Code or locally in a project

set -e

SKILL_NAME="$(basename "$(pwd)")"
SKILL_PATH="$(pwd)"

echo "📦 Installing $SKILL_NAME..."
echo ""

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "⚠️  Claude Code not found in PATH"
    echo "   Please install Claude Code first: https://claude.com/claude-code"
    exit 1
fi

# Check if we're in a git repository
if git rev-parse --git-dir > /dev/null 2>&1; then
    IN_REPO=true
    REPO_ROOT="$(git rev-parse --show-toplevel)"
    echo "📁 Detected git repository: $REPO_ROOT"
else
    IN_REPO=false
    echo "📁 Not in a git repository"
fi

# Ask installation type
echo ""
echo "Where would you like to install this skill?"
if [ "$IN_REPO" = true ]; then
    echo "  1) Locally (this repository only)"
    echo "  2) Globally (all Claude Code sessions)"
    read -p "Choose [1/2]: " choice
else
    echo "  Installing globally (not in a git repository)"
    choice=2
fi

# Install function
install_skill() {
    local config_dir=$1
    local config_file="$config_dir/claude_mcp_config.json"

    # Create config directory if it doesn't exist
    mkdir -p "$config_dir"

    # Create or update config file
    if [ ! -f "$config_file" ]; then
        echo "{" > "$config_file"
        echo '  "mcpServers": {}' >> "$config_file"
        echo "}" >> "$config_file"
    fi

    # Add skill to config using bun
    bun -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));

    if (!config.mcpServers) config.mcpServers = {};

    config.mcpServers['$SKILL_NAME'] = {
      command: 'bun',
      args: ['run', '$SKILL_PATH/src/index.ts'],
      env: {
        SKILL_API_KEY: process.env.SKILL_API_KEY || '',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        XAI_API_KEY: process.env.XAI_API_KEY || '',
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || '',
        GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || '',
        BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY || '',
        RUNWAY_API_KEY: process.env.RUNWAY_API_KEY || ''
      }
    };

    fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
    "

    echo "✅ Installed $SKILL_NAME to $config_file"
}

# Install based on choice
if [ "$choice" = "1" ]; then
    # Local installation
    install_skill "$REPO_ROOT/.claude"
    echo ""
    echo "🎉 $SKILL_NAME installed locally!"
    echo "   Config: $REPO_ROOT/.claude/claude_mcp_config.json"
elif [ "$choice" = "2" ]; then
    # Global installation
    install_skill "$HOME/.config/claude-code"
    echo ""
    echo "🎉 $SKILL_NAME installed globally!"
    echo "   Config: $HOME/.config/claude-code/claude_mcp_config.json"
else
    echo "❌ Invalid choice"
    exit 1
fi

echo ""
echo "📝 Next steps:"
echo "   1. Restart Claude Code"
echo "   2. The skill will be available as: $SKILL_NAME"
echo ""
echo "   Usage: Claude Code will automatically detect and use this skill"
echo "          based on your prompts and task context."
