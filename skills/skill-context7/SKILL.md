---
name: skill-context7
description: Access up-to-date library documentation and code examples. Get current API references, usage examples, and best practices for any programming library or framework. Use when working with external libraries or needing documentation.
---

# Context7 Documentation Skill

## What this Skill does

This Skill provides access to up-to-date documentation and code examples for programming libraries and frameworks through Context7's curated documentation database.

## When to use this Skill

Use this Skill when you need to:
- Look up current library documentation
- Find code examples for specific APIs
- Learn best practices for frameworks
- Get usage examples for library features
- Understand API signatures and parameters
- Find integration guides and tutorials
- Access documentation for multiple library versions

## MCP Server Connection

The Context7 MCP server provides access to curated library documentation.

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp@latest"]
  }
}
```

**No API key required** - Context7 is free and open

## Available Operations

The Context7 MCP server provides tools for:

- **Library Search**: Find libraries by name or functionality
- **Documentation Retrieval**: Get API docs and guides
- **Code Examples**: Access practical usage examples
- **Version Support**: View docs for specific versions
- **Best Practices**: Learn recommended patterns
- **Integration Guides**: Step-by-step setup instructions

## Supported Libraries

Context7 covers popular libraries across:
- **JavaScript/TypeScript**: React, Next.js, Express, Vue, etc.
- **Python**: FastAPI, Django, Flask, Pandas, etc.
- **Go**: Gin, Echo, GORM, etc.
- **Rust**: Actix, Tokio, Diesel, etc.
- **And many more**: Database drivers, cloud SDKs, utilities

## Documentation Modes

Context7 provides two search modes:
- **Code Mode** (default): API references and code examples
- **Info Mode**: Conceptual guides and narrative documentation

## Examples

### Example 1: API reference lookup
"How do I use React's useEffect hook?"
→ Claude retrieves current useEffect documentation and examples

### Example 2: Library integration
"Show me how to set up FastAPI with PostgreSQL"
→ Claude fetches integration guide and code examples

### Example 3: Best practices
"What are the best practices for Next.js data fetching?"
→ Claude finds recommended patterns and examples

### Example 4: Version-specific docs
"How do I use React Server Components in Next.js 14?"
→ Claude retrieves version-specific documentation

### Example 5: Code examples
"Give me examples of using Pandas groupby with aggregation"
→ Claude provides practical code examples

## Best practices

- Specify the library and feature you need help with
- Mention version numbers if working with specific releases
- Ask for code examples when learning new APIs
- Use for discovering best practices and patterns
- Leverage for integration and setup guides
- Reference when working with unfamiliar libraries

## Integration Notes

The Context7 MCP server automatically handles:
- Library name resolution
- Version matching
- Documentation retrieval
- Code example extraction
- Best practice identification
- Multi-library comparisons
