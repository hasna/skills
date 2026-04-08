---
name: skill-read-image
description: Analyze an image from a local path or URL with Claude vision. Supports prompt-controlled description, OCR, object counting, and brand/visual extraction.
---

# Read Image

Analyze an image with Claude vision and return structured JSON containing the prompt, model, and extracted analysis.

## Features

- Supports local files and remote URLs
- Accepts PNG, JPG, JPEG, GIF, and WEBP
- Prompt-controlled output for OCR, object counting, branding, layout analysis, and more
- Emits plain text or JSON

## Requirements

- `ANTHROPIC_API_KEY` must be available in the environment

## Usage

```bash
# Describe a local image
skill-read-image --input ./product-shot.jpg

# OCR a receipt from a URL
skill-read-image \
  --input https://example.com/receipt.png \
  --prompt "Extract every line item, subtotal, tax, and total."

# Return plain text only
skill-read-image --input ./wireframe.webp --text
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path-or-url>` | Local image path or image URL | required |
| `-p, --prompt <text>` | What Claude should extract or describe | detailed description + OCR |
| `-m, --model <name>` | Anthropic model to call | `ANTHROPIC_MODEL` or built-in default |
| `--max-tokens <n>` | Maximum response tokens | 1200 |
| `-o, --output <path>` | Save result to a file | stdout |
| `--text` | Emit only Claude's text response | false |
| `--help` | Show usage | |
| `--version` | Show version | |
