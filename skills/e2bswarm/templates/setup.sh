#!/bin/bash
# E2B Sandbox Setup Script
# This script is executed when the sandbox starts

set -e

echo "=== E2B Swarm Sandbox Setup ==="

# Install common tools
apt-get update -qq
apt-get install -y -qq git curl

# Install Bun
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Install Claude Code (if available)
# npm install -g @anthropic/claude-code || true

echo "=== Setup Complete ==="
