---
name: skill-notion
description: Manage Notion workspace, pages, databases, and content. Create, update, search pages, manage databases, add comments, and organize content. Use when working with Notion documents, wikis, or project management.
---

# Notion Workspace Management Skill

## What this Skill does

This Skill provides comprehensive Notion workspace management capabilities, allowing you to create, update, search, and organize Notion content through the MCP server.

## When to use this Skill

Use this Skill when you need to:
- Create and update Notion pages
- Manage databases and their records
- Search across your Notion workspace
- Add comments and collaborate on pages
- Organize content with tags and properties
- Query database views and filters
- Move and structure pages
- Export and sync content

## MCP Server Connection

The Notion MCP server provides access to your Notion workspace via API.

### Remote Connection (Recommended)
```json
{
  "notion": {
    "httpUrl": "https://mcp.notion.com/mcp"
  }
}
```

### NPM Package
```json
{
  "notion": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://mcp.notion.com/mcp"]
  }
}
```

**Setup**: Authenticate via OAuth when first connecting

## Available Operations

The Notion MCP server provides tools for:

- **Page Management**: Create, read, update, delete pages
- **Database Operations**: Query, filter, sort database records
- **Search**: Full-text search across workspace
- **Comments**: Add and manage page comments
- **Properties**: Set page properties and metadata
- **Blocks**: Manipulate page content blocks
- **Users**: Get user information and mentions
- **Teams**: Manage teamspaces

## Content Types

Notion supports rich content including:
- Text with formatting (bold, italic, code)
- Headings and lists
- Code blocks
- Tables and databases
- Images and files
- Embeds and bookmarks
- Callouts and quotes

## Examples

### Example 1: Create a page
"Create a Notion page about the new API design"
→ Claude creates a structured page with content

### Example 2: Update database
"Add a new task to the Sprint Planning database"
→ Claude creates a database entry with properties

### Example 3: Search content
"Find all pages mentioning 'authentication'"
→ Claude searches and lists matching pages

### Example 4: Query database
"Show me all high-priority tasks assigned to me"
→ Claude filters and displays database records

### Example 5: Add documentation
"Create meeting notes for today's standup"
→ Claude creates a formatted notes page

## Best practices

- Use rich formatting for better readability
- Leverage databases for structured content
- Add properties for filtering and organization
- Use search to find existing content before creating
- Tag and categorize pages appropriately
- Link related pages together
- Use templates for consistent structure
- Add comments for collaboration

## Integration Notes

The Notion MCP server automatically handles:
- OAuth authentication and token refresh
- Page and block hierarchy
- Database schema and properties
- Rich text formatting
- File uploads and attachments
- User mentions and permissions
- Rate limiting and retries
