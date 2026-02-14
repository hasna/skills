# skill-convert

File format conversion CLI with AI-powered extraction. Convert between images, PDFs, documents, and data formats with optional AI cleanup and OCR.

## Features

- **Image Conversion**: PNG, JPG, WebP, GIF, AVIF, TIFF with quality presets
- **Document Conversion**: PDF, DOCX, HTML, Markdown, TXT
- **Data Conversion**: CSV, Excel (XLSX), JSON, YAML, TSV
- **AI-Powered OCR**: Image to Markdown/Text using Claude or GPT-4o
- **PDF Extraction**: PDF to Markdown with AI cleanup
- **Quality Control**: Lossless, high, medium, low, web presets
- **Large File Handling**: Automatic chunking for AI processing
- **Batch Processing**: Convert entire directories

## Installation

```bash
cd skill-convert
bun install
```

## Configuration

For AI-powered conversions, set your API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-xxx...
# OR
export OPENAI_API_KEY=sk-xxx...
```

## Usage

### Basic Conversion

```bash
# Image format conversion
bun run src/index.ts convert photo.png --format jpg

# With quality preset
bun run src/index.ts convert photo.png --format webp --quality web

# Custom quality (0-100)
bun run src/index.ts convert photo.png --format jpg --quality-value 85
```

### Image Conversions

```bash
# PNG to WebP (optimized for web)
bun run src/index.ts convert image.png --format webp --quality web

# Resize image
bun run src/index.ts convert large.jpg --format jpg --width 1920 --quality medium

# GIF to PNG (extracts first frame)
bun run src/index.ts convert animation.gif --format png
```

### Images to PDF

```bash
# Single image
bun run src/index.ts convert scan.jpg --format pdf

# Multiple images to single PDF
bun run src/index.ts convert page1.jpg page2.jpg page3.jpg --format pdf --output document.pdf
```

### PDF Conversions

```bash
# PDF to plain text
bun run src/index.ts convert document.pdf --format txt

# PDF to Markdown (AI-powered)
bun run src/index.ts convert document.pdf --format md --clean

# PDF specific pages
bun run src/index.ts convert document.pdf --format txt --pages "1-5"
```

### Image to Text/Markdown (OCR)

```bash
# Screenshot to Markdown
bun run src/index.ts convert screenshot.png --format md

# Image to JSON (structured data)
bun run src/index.ts convert receipt.jpg --format json

# With AI cleanup
bun run src/index.ts convert scan.png --format md --clean
```

### Document Conversions

```bash
# DOCX to Markdown
bun run src/index.ts convert report.docx --format md

# DOCX to Markdown with AI cleanup
bun run src/index.ts convert report.docx --format md --clean

# HTML to Markdown
bun run src/index.ts convert page.html --format md

# Markdown to HTML
bun run src/index.ts convert readme.md --format html
```

### Data Conversions

```bash
# CSV to Excel
bun run src/index.ts convert data.csv --format xlsx

# Excel to CSV
bun run src/index.ts convert spreadsheet.xlsx --format csv

# JSON to YAML
bun run src/index.ts convert config.json --format yaml

# CSV to JSON
bun run src/index.ts convert data.csv --format json
```

### Batch Conversion

```bash
# Convert all images in directory to WebP
bun run src/index.ts batch ./images --format webp --output ./converted --quality web

# With verbose output
bun run src/index.ts batch ./scans --format pdf --output ./pdfs --verbose
```

### File Information

```bash
bun run src/index.ts info document.pdf
bun run src/index.ts info image.png
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `convert` | Convert a single file |
| `batch` | Convert multiple files |
| `info` | Show file information |
| `formats` | List supported formats |
| `help` | Show help |

## Options Reference

### Convert Options

| Option | Description |
|--------|-------------|
| `--format <fmt>` | Target format (required) |
| `--output <path>` | Output file path |
| `--quality <preset>` | Quality: lossless, high, medium, low, web |
| `--quality-value <n>` | Custom quality (0-100) |
| `--clean` | AI cleanup/sanitization |
| `--model <model>` | AI model: claude, gpt-4o, gpt-4o-mini |
| `--chunk-size <mb>` | Chunk size for large files |
| `--dpi <n>` | DPI for PDF rendering |
| `--width <n>` | Resize width |
| `--height <n>` | Resize height |
| `--pages <spec>` | Page range: "1-5" or "1,3,5" |
| `--verbose` | Detailed output |

## Quality Presets

| Preset | Quality | Use Case |
|--------|---------|----------|
| `lossless` | 100% | Archives, originals |
| `high` | 90% | High-quality output (default) |
| `medium` | 75% | Balanced quality/size |
| `low` | 50% | Small file size |
| `web` | 60% | Optimized for web |

## Supported Conversions

### Image Formats
- **Input**: PNG, JPG, JPEG, WebP, GIF, AVIF, TIFF, BMP
- **Output**: PNG, JPG, WebP, AVIF, TIFF

### Document Formats
- **Input**: PDF, DOCX, HTML, Markdown, TXT
- **Output**: Markdown, HTML, TXT, PDF (from images)

### Data Formats
- **Input**: CSV, XLSX, JSON, YAML, TSV
- **Output**: CSV, XLSX, JSON, YAML

### AI-Powered Conversions
These require an API key (Anthropic or OpenAI):
- Image to Markdown (OCR)
- Image to JSON (structured extraction)
- PDF to Markdown (with cleanup)
- DOCX to Markdown (with cleanup)

## Large File Handling

For files larger than 10MB, the AI-powered conversions automatically:
1. Split PDFs into chunks (default 5MB each)
2. Process each chunk separately
3. Combine results

Configure chunk size:
```bash
bun run src/index.ts convert large.pdf --format md --clean --chunk-size 3
```

## Examples

### Optimize Images for Web

```bash
# Single file
bun run src/index.ts convert hero.png --format webp --quality web

# Batch with resize
bun run src/index.ts batch ./photos --format webp --output ./optimized --quality web
```

### Extract Text from Scanned Documents

```bash
# Single scan
bun run src/index.ts convert scan.png --format md --clean

# Multi-page PDF
bun run src/index.ts convert scanned-doc.pdf --format md --clean --model gpt-4o
```

### Convert Spreadsheet Data

```bash
# Excel to multiple formats
bun run src/index.ts convert data.xlsx --format csv
bun run src/index.ts convert data.xlsx --format json
```

## License

MIT
