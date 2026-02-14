---
name: skill-linear
description: Work with Linear issues, projects, and workflows. Create, update, search issues, manage projects, cycles, and teams. Use when working with Linear project management tasks.
---

# Linear Project Management Skill

## What this Skill does

This Skill helps you interact with Linear for project management tasks using the Linear MCP server tools.

## When to use this Skill

Use this Skill when you need to:
- Create or update Linear issues
- Search for issues across projects
- Manage projects, milestones, and cycles
- Work with teams and assignments
- Track issue status and progress
- Comment on issues or discussions

## MCP Server Connection

The Linear MCP server provides access to Linear's API. To connect:

### Option 1: Remote SSE Connection (Recommended)
```json
{
  "linear": {
    "url": "https://mcp.linear.app/sse"
  }
}
```

### Option 2: NPM Package
```json
{
  "linear": {
    "command": "npx",
    "args": ["-y", "linear-mcp-server"],
    "env": {
      "LINEAR_API_KEY": "${LINEAR_API_KEY}"
    }
  }
}
```

**Setup**: Get your API key from Linear Settings → API → Personal API Keys

## Available Operations

The Linear MCP server provides tools for:

- **Issue Management**: Create, update, search, and manage issues
- **Projects**: List and manage projects and roadmaps
- **Teams**: Work with team structures and assignments
- **Cycles**: Manage sprint cycles and iterations
- **Comments**: Add comments and discussions to issues
- **Labels**: Organize issues with labels and tags
- **Status**: Track and update issue states

## Examples

### Example 1: Create an issue
"Create a Linear issue for implementing the new authentication system"
→ Claude uses Linear MCP tools to create an issue with details

### Example 2: Search issues
"Find all high-priority bugs in the backend project"
→ Claude searches Linear and provides filtered results

### Example 3: Update issue status
"Move issue LIN-123 to In Progress"
→ Claude updates the issue status using Linear tools

### Example 4: List project issues
"Show me all issues in the Q1 Roadmap project"
→ Claude fetches and displays project issues

## Best practices

- Reference specific issue IDs when updating (e.g., "LIN-123")
- Include priority, labels, and assignees when creating issues
- Use clear descriptions for better issue tracking
- Leverage Linear's project hierarchy for organization
- Set appropriate due dates and cycles

## Integration Notes

The Linear MCP server automatically handles:
- Authentication via API key
- Rate limiting and retries
- Issue state transitions
- Team and project resolution
