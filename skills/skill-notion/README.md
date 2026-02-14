# skill-notion

Manage Notion workspace, pages, databases, and content

## Overview

This Skill provides comprehensive Notion workspace management for creating pages, managing databases, searching content, and organizing documentation.

## MCP Server

Uses the Notion MCP server for workspace access.

Connection: Remote HTTP at `https://mcp.notion.com/mcp`

## Usage

This Skill is automatically invoked by Claude Code when working with Notion tasks.

Example requests:
- "Create a Notion page for the API design"
- "Add a task to the Sprint Planning database"
- "Find all pages about authentication"
- "Show me high-priority tasks"

## Setup

Authenticate via OAuth when first connecting to Notion MCP.
