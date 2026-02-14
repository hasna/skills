# skill-extract

Extract text and structured data from images and PDFs using OpenAI Vision.

## Overview

This skill provides capabilities for extracting text and structured content from:
- **Images**: Using OpenAI GPT-4 Vision for accurate OCR
- **PDFs**: Native text parsing with optional AI-powered cleanup and structuring

Output formats include plain text, Markdown, and structured JSON.

## Installation

```bash
bun install
```

## Usage

```bash
# Extract text from an image
bun run src/index.ts extract --input ./image.png --output ./output.txt

# Extract Markdown from a PDF
bun run src/index.ts extract --input ./document.pdf --format markdown

# Extract with custom prompt
bun run src/index.ts extract \
  --input ./invoice.png \
  --format json \
  --prompt "Extract invoice details"

# Show help
bun run src/index.ts help
```

## Options

- `--input, -i` - Input file (image or PDF)
- `--output, -o` - Output file path
- `--format, -f` - Output format: text, markdown, json
- `--prompt, -p` - Custom extraction prompt
- `--model, -m` - OpenAI model (default: gpt-4o)
- `--detail, -d` - Image detail level: low, high, auto

## Environment Variables

```bash
export OPENAI_API_KEY="your-api-key"
```

## Supported Formats

**Images**: PNG, JPG, JPEG, GIF, WEBP, BMP, TIFF

**Documents**: PDF

## Development

See `SKILL.md` for detailed documentation.
