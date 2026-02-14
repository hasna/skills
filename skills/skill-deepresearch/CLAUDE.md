# skill-deepresearch

Agentic deep research skill using Exa.ai and LLM synthesis.

## Quick Reference

```bash
# Run the skill
bun run src/index.ts "<topic>" [options]

# Options
--depth <quick|normal|deep>   # Research depth (default: normal)
--model <claude|openai>       # LLM provider (default: claude)
--output <path>               # Custom output path
--json                        # Also output sources JSON
--no-firecrawl               # Skip deep scraping
```

## Project Structure

- `src/index.ts` - CLI entry point
- `src/research.ts` - Main research orchestration
- `src/agents/` - LLM agents for query generation and synthesis
- `src/services/` - API clients (Exa, Anthropic, OpenAI, Firecrawl)
- `src/utils/` - Logger and file helpers
- `src/types.ts` - TypeScript types

## API Keys

Required in `~/.secrets`:
- `EXA_API_KEY` - For search
- `ANTHROPIC_API_KEY` - For Claude synthesis
- `OPENAI_API_KEY` - For OpenAI synthesis (alternative)
- `FIRECRAWL_API_KEY` - Optional, for deep scraping

## Output Location

`~/.skills/skill-deepresearch/exports/`

## Depth Levels

- **quick**: 6 queries, 1 iteration
- **normal**: 15 queries, 1 iteration
- **deep**: 30 queries, 2 iterations (with follow-up based on gaps)
