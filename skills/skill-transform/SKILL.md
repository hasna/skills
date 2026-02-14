---
name: Content Transform
description: Transform, convert, and reformat content using AI. Supports format conversion (JSON, YAML, Markdown, etc.), summarization, expansion, style rewriting, translation, and custom transformations.
---

# Content Transform Skill

This skill uses AI to transform content in various ways - convert formats, summarize, expand, rewrite in different styles, translate, extract information, and more.

## Transformation Types

| Type | Description |
|------|-------------|
| format | Improve formatting and readability |
| convert | Convert between formats (JSON, YAML, Markdown, HTML, etc.) |
| summarize | Create a concise summary |
| expand | Elaborate with more detail and examples |
| rewrite | Rewrite in a different style |
| extract | Extract key information and facts |
| translate | Translate to another language |
| structure | Add/improve document structure |
| custom | Apply custom transformation with your prompt |

## Usage

### Format Conversion
```bash
# JSON to YAML
bun run src/index.ts transform \
  --input data.json \
  --type convert \
  --to yaml

# Markdown to HTML
bun run src/index.ts transform \
  --input doc.md \
  --type convert \
  --to html
```

### Summarization
```bash
bun run src/index.ts transform \
  --input long-report.md \
  --type summarize \
  --output summary.md
```

### Style Rewriting
```bash
# Make casual text formal
bun run src/index.ts transform \
  --input draft.txt \
  --type rewrite \
  --style formal

# Make technical content conversational
bun run src/index.ts transform \
  --input docs.md \
  --type rewrite \
  --style conversational
```

### Translation
```bash
bun run src/index.ts transform \
  --input article.md \
  --type translate \
  --language Spanish \
  --output article-es.md
```

### Information Extraction
```bash
bun run src/index.ts transform \
  --input meeting-notes.txt \
  --type extract \
  --to json \
  --output action-items.json
```

### Custom Transformation
```bash
bun run src/index.ts transform \
  --input code.ts \
  --type custom \
  --prompt "Add JSDoc comments to all functions"
```

## Supported Formats

- **text** - Plain text
- **markdown** - Markdown documents
- **html** - HTML documents
- **json** - JSON data
- **yaml** - YAML configuration
- **csv** - Comma-separated values
- **xml** - XML documents
- **code** - Source code

## Writing Styles (for rewrite)

| Style | Description |
|-------|-------------|
| formal | Professional, polished |
| casual | Relaxed, friendly |
| technical | Precise, detailed |
| academic | Scholarly, objective |
| business | Clear, action-oriented |
| creative | Engaging, imaginative |
| journalistic | Factual, balanced |
| conversational | Natural, like speaking |

## Configuration

```bash
export ANTHROPIC_API_KEY=your_anthropic_key
```

## Features

- Auto-detection of input formats
- Intelligent format conversion
- Multiple writing style options
- Language translation support
- Custom prompt transformations
- Structure preservation option
