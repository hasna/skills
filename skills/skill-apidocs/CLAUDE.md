# service-apidocs

Agentic web crawler for API documentation indexing and semantic search.

## Overview

This service uses an intelligent web crawler to index API documentation from any website, stores vector embeddings in AWS S3 Vectors or locally, and provides semantic search capabilities for AI assistants. It also extracts structured API endpoint information for easy reference.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: DOCS DISCOVERY                              │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────────┐       │
│  │  User:      │───▶│  Discovery Agent │───▶│  Check common paths   │       │
│  │  stripe.com │    │  (find docs)     │    │  /docs, /api, etc.    │       │
│  └─────────────┘    └──────────────────┘    └───────────────────────┘       │
│                              │                                               │
│                              ▼                                               │
│                     ┌──────────────────┐                                     │
│                     │  Found:          │                                     │
│                     │  stripe.com/docs │                                     │
│                     └──────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 2: PAGE CRAWLING                               │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌───────────────────┐   │
│  │  BFS Crawler     │───▶│  All Doc Pages      │───▶│  Save to Cache    │   │
│  │  (from docs URL) │    │  (HTML + Markdown)  │    │  pages-*.json     │   │
│  └──────────────────┘    └─────────────────────┘    └───────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 3: ENDPOINT EXTRACTION                         │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌───────────────────┐   │
│  │  Claude Agent    │───▶│  Structured         │───▶│  Save Endpoints   │   │
│  │  (extract APIs)  │    │  Endpoint Data      │    │  endpoints.json   │   │
│  └──────────────────┘    └─────────────────────┘    └───────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 4: CHUNKING & EMBEDDING                        │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌───────────────────┐   │
│  │  Parser/Chunker  │───▶│  OpenAI Embeddings  │───▶│  Vector Store     │   │
│  │  (remark)        │    │  (text-embed-3-sm)  │    │  (Local/S3)       │   │
│  └──────────────────┘    └─────────────────────┘    └───────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **CLI**: Commander.js
- **AI Agent**: Claude Sonnet 4 (@anthropic-ai/sdk) - optional, for content cleanup
- **HTML→Markdown**: turndown
- **Markdown Parser**: remark + mdast
- **Embeddings**: OpenAI text-embedding-3-small (1536 dimensions)
- **Vector Store**: Local JSON files (default) or AWS S3 Vectors

## Project Structure

```
service-apidocs/
├── bin/
│   └── cli.ts                 # CLI entry point
├── src/
│   ├── commands/              # CLI commands
│   │   ├── add.ts             # Add documentation from website
│   │   ├── query.ts           # Query documentation
│   │   ├── list.ts            # List libraries
│   │   ├── sync.ts            # Re-crawl documentation
│   │   ├── remove.ts          # Remove library
│   │   └── endpoints.ts       # List API endpoints
│   ├── lib/                   # Core modules
│   │   ├── crawler.ts         # Web crawler with discovery & extraction
│   │   ├── discovery.ts       # Agentic docs URL discovery
│   │   ├── endpoint-extractor.ts # Claude-powered endpoint extraction
│   │   ├── html-to-md.ts      # HTML to Markdown conversion
│   │   ├── parser.ts          # Markdown parser/chunker
│   │   ├── embeddings.ts      # OpenAI embeddings
│   │   ├── vectors.ts         # Vector store abstraction
│   │   ├── vectors-local.ts   # Local file-based vectors
│   │   ├── vectors-s3.ts      # AWS S3 Vectors client
│   │   ├── search.ts          # Semantic search
│   │   └── storage.ts         # Local storage
│   ├── types/
│   │   └── index.ts           # TypeScript types
│   └── utils/
│       ├── paths.ts           # Path/URL utilities
│       └── output.ts          # CLI output helpers
```

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` - For Claude agent (docs discovery, endpoint extraction)
- `OPENAI_API_KEY` - For embeddings

Optional:
- `USE_S3_VECTORS` - Set to `true` to use AWS S3 Vectors (default: local JSON files)
- `AWS_REGION` - AWS region (default: us-east-1)
- `S3_VECTORS_BUCKET` - Vector bucket name (default: service-apidocs-vectors)

## CLI Commands

```bash
# Add documentation from a website
# If URL is not a docs URL, discovery will find the docs automatically
service-apidocs add https://stripe.com --name stripe          # Auto-discovers stripe.com/docs
service-apidocs add https://platform.openai.com/docs          # Uses URL directly (already docs)
service-apidocs add https://docs.anthropic.com --name anthropic
service-apidocs add https://hono.dev/docs --max-pages 100

# Query documentation (semantic search)
service-apidocs query openai "how to use function calling"
service-apidocs query anthropic "tool use examples" --tokens 5000
service-apidocs query hono "create a route" --json

# List indexed libraries (shows endpoint counts)
service-apidocs list

# List API endpoints from indexed documentation
service-apidocs endpoints openai                              # Group by resource (default)
service-apidocs endpoints openai --group-by method            # Group by HTTP method
service-apidocs endpoints openai --filter POST                # Show only POST endpoints
service-apidocs endpoints openai --json                       # Output as JSON

# Sync documentation (re-crawl)
service-apidocs sync openai
service-apidocs sync --all
service-apidocs sync openai --max-pages 200

# Remove library
service-apidocs remove openai
```

## Local Storage

Data is stored in `~/.service/service-apidocs/`:

```
~/.service/service-apidocs/
├── config.json              # Global config
├── vectors/                 # Local vector store (when USE_S3_VECTORS is not set)
│   └── {index-name}.json    # Vectors with embeddings and metadata
└── libraries/
    └── {library-id}/
        ├── metadata.json    # Library metadata (name, URL, docsUrl, endpoint count)
        ├── endpoints.json   # Extracted API endpoints (structured data)
        └── cache/
            ├── pages-0.json # Crawled pages
            └── chunks-0.json # Parsed chunks
```

## Vector Metadata

Each vector stores:
- `libraryId` - e.g., "openai"
- `version` - Date indexed (e.g., "2024-01-15")
- `filePath` - URL path (e.g., "/docs/api/chat")
- `chunkIndex` - Position in document
- `title` - Section heading
- `type` - "code" or "text"
- `content` - Full chunk content

## Processing Pipeline

1. Parse website URL
2. **Discover docs URL** (if base URL provided, finds /docs, /api, etc.)
3. Initialize crawler
4. Crawl documentation pages (BFS within domain)
5. Convert HTML to Markdown (turndown)
6. **Extract API endpoints** (Claude agent extracts method, path, params, etc.)
7. Parse and chunk by headings (~500 tokens)
8. Generate OpenAI embeddings
9. Create vector index
10. Upsert vectors with metadata
11. Save endpoints and metadata locally

## Crawler Design

The crawler uses a breadth-first search approach:

1. **Discovery**: Aggressively follows ALL links within the same domain
2. **Filtering**: Skips obvious non-doc URLs (blog, pricing, careers, etc.)
3. **Validation**: Checks if page content looks like documentation (code blocks, API terms, etc.)
4. **Extraction**: Extracts main content area, removes nav/header/footer
5. **Conversion**: Converts HTML to clean Markdown via turndown
6. **Deduplication**: Tracks content hashes to avoid duplicates

### URL Filtering
- Follows all links within the same domain
- Skips: images, PDFs, auth pages, cart/checkout, search pages
- Skips non-doc patterns: /blog/, /careers/, /pricing/, /terms/, etc.

### Content Detection
Pages are included if they have 2+ documentation indicators:
- Code blocks (`<pre>`, `<code>`, triple backticks)
- API terms (endpoint, parameter, request, response)
- Doc terms (example, usage, guide, tutorial, reference)

### Optional: Claude Content Cleanup
Use `enhanceContentWithAgent()` after crawling to have Claude clean up extracted content:
- Removes navigation remnants
- Removes ads and cookie notices
- Preserves code examples and API references

## API Endpoint Extraction

The endpoint extractor uses Claude to analyze documentation pages and extract structured API information:

### Extracted Data
- **method**: HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
- **path**: Endpoint path (e.g., `/users/{id}`, `/v1/chat/completions`)
- **title**: Short description of what the endpoint does
- **description**: Full description from documentation
- **parameters**: Path, query, header, and cookie parameters
- **requestBody**: Content type, schema, and examples
- **responses**: Status codes and response descriptions
- **codeExamples**: Code snippets in various languages (curl, Python, JavaScript, etc.)

### Grouping
Endpoints are automatically grouped by:
- **Resource**: Extracted from the path (e.g., `/users/{id}` → `users`)
- **Method**: HTTP method (GET, POST, etc.)

### Output Formats
```bash
# Human-readable grouped by resource (default)
service-apidocs endpoints stripe

# Human-readable grouped by method
service-apidocs endpoints stripe --group-by method

# JSON for programmatic use
service-apidocs endpoints stripe --json
```

## Docs URL Discovery

When you provide a base URL (like `stripe.com`), the discovery agent:

1. **Checks common patterns**: `/docs`, `/api`, `/api-reference`, `/documentation`, `/developers`
2. **Checks subdomains**: `docs.`, `api.`, `developers.`
3. **Analyzes page content**: Uses Claude to find documentation links in the page

This allows you to simply provide a company URL and have the tool find the API docs automatically.

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run bin/cli.ts add https://hono.dev/docs --max-pages 20

# Type check
bun run typecheck

# Link globally
bun link
```

## Notes

- Chunks are sized to ~500 tokens for optimal retrieval
- Code blocks are extracted as separate chunks with language info
- Heading hierarchy is preserved for context
- Results are deduplicated by content similarity
- Response is formatted as markdown with sources
- Crawler respects same-domain policy
- Non-documentation pages (blog, pricing, etc.) are automatically skipped
