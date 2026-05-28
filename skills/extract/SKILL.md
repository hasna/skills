---
name: extract
description: Extract text and structured data from images and PDFs using OpenAI Vision
---

# Extraction Skill

Extract text, data, and structured content from images and PDF documents using OpenAI Vision.

## Capabilities

- **Image OCR**: Extract text from images using GPT-4 Vision
- **PDF Text Extraction**: Parse text from PDF documents
- **Structured Output**: Output as plain text, Markdown, or JSON
- **Custom Prompts**: Direct the extraction with specific instructions

## Supported Formats

### Input
- **Images**: PNG, JPG, JPEG, GIF, WEBP, BMP, TIFF
- **Documents**: PDF

### Output
- **text**: Clean, readable plain text
- **markdown**: Structured Markdown with headings, lists, and tables
- **json**: Structured JSON with sections, tables, and metadata

## Usage

```bash
# Extract text from an image
bun run src/index.ts extract --input ./receipt.png --output ./receipt.txt

# Extract as Markdown from a PDF
bun run src/index.ts extract -i ./document.pdf -o ./document.md -f markdown

# Extract with custom prompt
bun run src/index.ts extract \
  --input ./invoice.png \
  --format json \
  --prompt "Extract invoice number, date, total amount, and line items"

# High-detail extraction for small text
bun run src/index.ts extract \
  --input ./handwriting.jpg \
  --detail high \
  --format text
```

## Options

| Option | Short | Description |
|--------|-------|-------------|
| `--input` | `-i` | Input file path (required) |
| `--output` | `-o` | Output file path (optional) |
| `--format` | `-f` | Output format: text, markdown, json |
| `--prompt` | `-p` | Custom extraction prompt |
| `--model` | `-m` | OpenAI model (default: gpt-4o) |
| `--detail` | `-d` | Image detail: low, high, auto |

## Environment Variables

```bash
export OPENAI_API_KEY="your-openai-key"
```

## Examples

### Receipt Extraction
```bash
bun run src/index.ts extract \
  --input ./receipt.jpg \
  --format json \
  --prompt "Extract store name, date, items with prices, subtotal, tax, and total"
```

### Document to Markdown
```bash
bun run src/index.ts extract \
  --input ./report.pdf \
  --format markdown \
  --output ./report.md
```

### Handwritten Notes
```bash
bun run src/index.ts extract \
  --input ./notes.jpg \
  --detail high \
  --prompt "Transcribe the handwritten text, preserving the structure"
```
