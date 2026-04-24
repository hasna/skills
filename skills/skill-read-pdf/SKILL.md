---
name: read-pdf
description: Analyze PDF files with Claude document blocks. Supports page-range selection, 20-page chunking, and merged structured output.
---

# Read PDF

Analyze a PDF with Claude's native document support and return structured output for the requested pages.

## Features

- Supports page range selection like `1-5,8,10-12`
- Chunks large selections into windows of up to 20 pages per request
- Emits merged JSON, markdown, or plain-text output
- Preserves chunk/page metadata so downstream tools can trace the source pages

## Requirements

- `ANTHROPIC_API_KEY` must be available in the environment

## Usage

```bash
# Read the whole PDF with markdown output
skill-read-pdf --input ./deck.pdf

# Restrict to a few pages
skill-read-pdf --input ./contract.pdf --pages 1-3,8 --format text

# Ask for specific structure and save it
skill-read-pdf \
  --input ./invoice.pdf \
  --prompt "Extract invoice metadata, every line item, and the payment terms." \
  --format json \
  --output ./invoice.json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path-or-url>` | PDF file path or URL | required |
| `--pages <ranges>` | Page ranges like `1-5,8,10-12` | all pages |
| `-p, --prompt <text>` | What Claude should extract | text + tables + structure |
| `-f, --format <value>` | `json`, `markdown`, or `text` | `markdown` |
| `-m, --model <name>` | Anthropic model to call | `ANTHROPIC_MODEL` or built-in default |
| `--chunk-size <n>` | Pages per request (max 20) | 20 |
| `--max-tokens <n>` | Maximum response tokens per chunk | 1600 |
| `-o, --output <path>` | Save result to a file | stdout |
| `--text` | Emit only the merged extracted text | false |
| `--help` | Show usage | |
| `--version` | Show version | |
