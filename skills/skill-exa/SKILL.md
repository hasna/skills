---
name: skill-exa
description: Advanced web search and code search using Exa AI. Search the web with semantic understanding, find code examples, documentation, and technical content. Use for research, finding examples, or discovering technical information.
---

# Exa AI Search Skill

## What this Skill does

This Skill provides advanced web search capabilities using Exa AI, which specializes in semantic search, code discovery, and technical content retrieval.

## When to use this Skill

Use this Skill when you need to:
- Search the web with semantic understanding
- Find code examples and snippets
- Discover documentation and technical articles
- Research libraries, frameworks, and APIs
- Get contextual information from web content
- Find high-quality technical resources

## MCP Server Connection

The Exa MCP server provides access to Exa AI's search capabilities.

```json
{
  "exa": {
    "command": "npx",
    "args": ["-y", "exa-mcp-server"],
    "env": {
      "EXA_API_KEY": "your-api-key-here"
    }
  }
}
```

**Setup**: Get your API key from [exa.ai](https://exa.ai)

## Available Operations

The Exa MCP server provides tools for:

- **Web Search**: Semantic web search with high-quality results
- **Code Search**: Find code examples and implementations
- **Documentation Search**: Discover technical documentation
- **Content Extraction**: Get detailed content from URLs
- **Similar Content**: Find related articles and resources

## Search Capabilities

Exa excels at:
- Understanding intent and context
- Finding technical and programming content
- Filtering for quality sources
- Providing relevant code examples
- Discovering documentation and guides

## Examples

### Example 1: Find code examples
"Search for React hooks examples using useEffect for data fetching"
→ Claude uses Exa to find relevant code examples

### Example 2: Research a library
"Find documentation and examples for FastAPI authentication"
→ Claude searches for FastAPI auth resources

### Example 3: Technical research
"What are the best practices for PostgreSQL connection pooling?"
→ Claude uses Exa to find technical articles and documentation

### Example 4: Find similar content
"Find articles similar to this URL about microservices patterns"
→ Claude discovers related technical content

## Best practices

- Use specific, technical queries for better results
- Include programming languages or frameworks when searching for code
- Ask for examples, documentation, or guides explicitly
- Leverage semantic search for concept-based queries
- Use Exa for technical content over general web search

## Integration Notes

The Exa MCP server automatically handles:
- API authentication
- Query optimization
- Result ranking and filtering
- Content extraction from URLs
- Rate limiting
