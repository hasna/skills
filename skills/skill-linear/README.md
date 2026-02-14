# skill-linear

Work with Linear issues, projects, and workflows

## Overview

This Skill provides capabilities for managing Linear project management tasks including creating issues, updating status, searching across projects, and managing teams and cycles.

## MCP Server

Uses the Linear MCP server for API access.

Connection options:
- Remote SSE: `https://mcp.linear.app/sse`
- NPM package: `linear-mcp-server`

## Usage

This Skill is automatically invoked by Claude Code when working with Linear-related tasks.

Example requests:
- "Create a Linear issue for the authentication bug"
- "Find all high-priority issues in the backend project"
- "Update LIN-123 to In Progress"

## Setup

Get your Linear API key from: Linear Settings → API → Personal API Keys
