# skill-deepresearch

Agentic deep research skill that uses Exa.ai for parallel semantic search and Claude/OpenAI for report synthesis. Inspired by how Perplexity, OpenAI, and Anthropic implement deep research.

## How It Works

1. **Query Generation** - LLM analyzes your topic and generates diverse search queries
2. **Parallel Search** - Executes searches in parallel via Exa.ai (5 concurrent limit)
3. **Content Retrieval** - Gets clean content from search results
4. **Optional Deep Scrape** - Uses Firecrawl for JS-rendered pages
5. **Synthesis** - LLM compiles findings into a structured report with citations

## Installation

```bash
# Install from npm
bun add @hasnaxyz/skill-deepresearch

# Or clone and install
cd ~/Workspace/dev/hasnaxyz/skill/skilldev/skill-deepresearch
bun install
```

### Claude Code Skill

Link to Claude Code skills directory:
```bash
ln -s ~/Workspace/dev/hasnaxyz/skill/skilldev/skill-deepresearch ~/.claude/skills/deepresearch
```

Then invoke with `/deepresearch "your topic"` in Claude Code.

### OpenAI Codex Skill

Link to Codex skills directory:
```bash
ln -s ~/Workspace/dev/hasnaxyz/skill/skilldev/skill-deepresearch ~/.codex/skills/deepresearch
```

Then invoke with `/deepresearch "your topic"` in Codex.

## Configuration

Set API keys in `~/.secrets`:

```bash
# Required
export EXA_API_KEY="your_exa_key"

# At least one required for synthesis
export ANTHROPIC_API_KEY="your_anthropic_key"
export OPENAI_API_KEY="your_openai_key"

# Optional
export FIRECRAWL_API_KEY="your_firecrawl_key"
```

## Usage

```bash
# Basic usage
bun run src/index.ts "What are the best practices for building RAG systems?"

# Quick research (6 queries)
bun run src/index.ts "What is vector search?" --depth quick

# Deep research (30 queries, 2 iterations)
bun run src/index.ts "Compare React Server Components vs traditional SSR" --depth deep

# Use OpenAI instead of Claude
bun run src/index.ts "State of AI in 2024" --model openai

# Custom output location
bun run src/index.ts "Kubernetes best practices" --output ./k8s-research.md

# Include raw sources JSON
bun run src/index.ts "GraphQL vs REST APIs" --json

# Skip Firecrawl deep scraping
bun run src/index.ts "Machine learning ops" --no-firecrawl
```

## Depth Levels

| Level | Queries | Iterations | Use Case |
|-------|---------|------------|----------|
| quick | 6 | 1 | Fast overview |
| normal | 15 | 1 | Standard research |
| deep | 30 | 2 | Thorough analysis with follow-up queries |

## Output

Reports are saved to `~/.skills/skill-deepresearch/exports/`:

```
~/.skills/skill-deepresearch/
├── exports/
│   ├── report-what-is-rag-2024-01-15T10-30-00.md
│   └── sources-what-is-rag-2024-01-15T10-30-00.json
└── logs/
```

### Report Format

```markdown
# Research Report: [Topic]

**Generated:** 2024-01-15T10:30:00Z
**Depth:** normal
**Queries:** 15
**Sources:** 42

---

## Executive Summary
[2-3 paragraph overview]

## Key Findings
- Finding 1 [1]
- Finding 2 [2]
...

## Detailed Analysis
### Subtopic 1
...

## Conclusions
...

---

## Sources
1. [Title](url) - Published Date
2. [Title](url)
...
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── research.ts           # Main orchestration
├── types.ts              # TypeScript types
├── agents/
│   ├── query-generator.ts    # LLM query generation
│   └── synthesizer.ts        # LLM report synthesis
├── services/
│   ├── exa.ts                # Exa.ai search
│   ├── anthropic.ts          # Claude API
│   ├── openai.ts             # OpenAI API
│   └── firecrawl.ts          # Firecrawl scraping
└── utils/
    ├── logger.ts             # Console output
    └── file.ts               # File operations
```

## Claude Code Integration

This skill can be invoked from Claude Code using:

```
/deepresearch "your research topic"
```

See `SKILL.md` for skill metadata.

## License

MIT
