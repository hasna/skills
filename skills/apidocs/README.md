# service-apidocs

An agentic web crawler CLI tool for indexing and querying API documentation from any website using semantic search. Automatically discovers documentation URLs and extracts structured API endpoint information.

## Features

- **Automatic docs discovery** - Provide a base URL (`stripe.com`) and it finds the API docs
- **API endpoint extraction** - Extracts structured endpoint data (method, path, parameters, etc.)
- **Semantic search** - Query documentation using natural language
- **Multiple storage backends** - Local JSON files or AWS S3 Vectors

## Installation

```bash
# Install globally from npm
bun install -g @hasnaxyz/service-apidocs

# Or clone and install locally
git clone https://github.com/hasnaxyz/service-apidocs.git
cd service-apidocs
bun install
bun link
```

## Setup

Set required environment variables:

```bash
# Required - add to ~/.secrets
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-...  # For docs discovery and endpoint extraction

# Optional - use AWS S3 Vectors instead of local storage
export USE_S3_VECTORS=true
```

By default, vectors are stored locally in `~/.service/service-apidocs/vectors/`. Set `USE_S3_VECTORS=true` to use AWS S3 Vectors (requires AWS credentials with S3 Vectors permissions).

## Usage

### Add Documentation

Index documentation from any website:

```bash
# Add documentation - auto-discovers docs URL from base URL
service-apidocs add https://stripe.com --name stripe
# -> Discovers and crawls stripe.com/docs

# Add when URL is already the docs page
service-apidocs add https://platform.openai.com/docs

# Add with custom name
service-apidocs add https://docs.anthropic.com --name anthropic

# Limit number of pages to crawl
service-apidocs add https://hono.dev/docs --max-pages 100
```

The add command now:
1. Discovers the documentation URL if you provide a base URL
2. Crawls all documentation pages
3. Extracts structured API endpoints using Claude
4. Generates embeddings for semantic search

### Query Documentation

Search documentation semantically:

```bash
# Basic query
service-apidocs query openai "how to use function calling"

# Limit response size
service-apidocs query anthropic "tool use examples" --tokens 5000

# JSON output
service-apidocs query hono "create a route" --json
```

### List Indexed Libraries

```bash
service-apidocs list
```

Output:
```
Indexed Libraries
────────────────────────────────────────────────────────────────────────────────
openai     platform.openai.com  47 pages   234 chunks  47 endpoints  1/29/2026
anthropic  docs.anthropic.com   32 pages   156 chunks  23 endpoints  1/29/2026

Documentation URLs:
  anthropic: https://docs.anthropic.com/api

Total: 2 libraries
```

### List API Endpoints

View extracted API endpoints from indexed documentation:

```bash
# Group by resource (default)
service-apidocs endpoints openai

# Output:
# openai API Endpoints (47 total)
# Docs: https://platform.openai.com/docs
#
# Chat
#   POST    /v1/chat/completions  Create a chat completion
#
# Embeddings
#   POST    /v1/embeddings        Create embeddings
#
# Files
#   GET     /v1/files             List files
#   POST    /v1/files             Upload a file
#   DELETE  /v1/files/{file_id}   Delete a file

# Group by HTTP method
service-apidocs endpoints openai --group-by method

# Filter by method
service-apidocs endpoints openai --filter POST

# JSON output for programmatic use
service-apidocs endpoints openai --json
```

### Sync Documentation

Re-crawl and update an existing library's index:

```bash
# Sync single library
service-apidocs sync openai

# Sync all libraries
service-apidocs sync --all

# Sync with custom page limit
service-apidocs sync openai --max-pages 200
```

### Remove a Library

```bash
service-apidocs remove openai
```

## How It Works

1. **Discovers** documentation URL from base website (checks /docs, /api, subdomains, etc.)
2. **Crawls** documentation website following links within the same domain
3. **Extracts** main content and converts HTML to Markdown
4. **Extracts endpoints** using Claude to identify API endpoints with structured data
5. **Parses** content and splits into semantic chunks (~500 tokens each)
6. **Generates** embeddings using OpenAI text-embedding-3-small
7. **Stores** vectors and endpoints locally or in AWS S3 Vectors
8. **Queries** using semantic similarity and returns relevant documentation

## Crawler Features

- **Intelligent page detection**: Automatically identifies documentation pages vs marketing/blog content
- **Same-domain crawling**: Only follows links within the documentation site
- **Content extraction**: Uses common documentation selectors to extract main content
- **HTML to Markdown**: Converts crawled HTML to clean Markdown for better chunking
- **Duplicate prevention**: Tracks visited URLs to avoid re-crawling

## API Endpoint Extraction

The tool extracts structured endpoint information including:

- **Method**: GET, POST, PUT, DELETE, PATCH, etc.
- **Path**: `/users/{id}`, `/v1/chat/completions`
- **Parameters**: Path, query, header parameters with types and descriptions
- **Request body**: Content type and example payloads
- **Responses**: Status codes and descriptions
- **Code examples**: curl, Python, JavaScript, etc.

Endpoints are automatically grouped by resource (extracted from path) for easy browsing.

## Requirements

- Bun runtime
- OpenAI API key (for embeddings)
- Anthropic API key (for docs discovery and endpoint extraction)
- AWS credentials (optional, only if using S3 Vectors)

## License

MIT
