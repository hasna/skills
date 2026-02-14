# skill-convert

## Description

File format conversion skill with AI-powered extraction capabilities. Converts between images, PDFs, documents, and data formats with optional quality control and AI cleanup.

## Category

File Processing / Format Conversion

## Commands

### convert
Convert a single file to another format.

```bash
bun run src/index.ts convert <input> --format <fmt> [options]
```

Options:
- `--format <fmt>` - Target format (required)
- `--output <path>` - Output file path
- `--quality <preset>` - Quality preset (lossless, high, medium, low, web)
- `--clean` - AI cleanup/sanitization
- `--model <model>` - AI model (claude, gpt-4o)

### batch
Convert multiple files in a directory.

```bash
bun run src/index.ts batch <dir> --format <fmt> --output <outdir> [options]
```

### info
Display file information.

```bash
bun run src/index.ts info <file>
```

### formats
List all supported formats and conversion matrix.

```bash
bun run src/index.ts formats
```

## Dependencies

### NPM Packages
- `sharp` - Image processing
- `pdf-lib` - PDF manipulation
- `pdf-parse` - PDF text extraction
- `mammoth` - DOCX parsing
- `exceljs` - Excel file handling
- `csv-parse/csv-stringify` - CSV processing
- `@anthropic-ai/sdk` - Claude AI
- `openai` - GPT-4o AI

### API Keys (for AI features)
- `ANTHROPIC_API_KEY` - For Claude-powered conversions
- `OPENAI_API_KEY` - For GPT-4o-powered conversions

## Conversion Categories

### Image Processing
- Format conversion (PNG, JPG, WebP, AVIF, GIF, TIFF)
- Quality optimization (5 presets)
- Resize support
- Images to PDF

### Document Processing
- PDF to text/markdown
- DOCX to markdown/text/HTML
- HTML to markdown
- Markdown to HTML

### Data Processing
- CSV to/from Excel, JSON, YAML
- JSON to/from YAML
- TSV conversions

### AI-Powered
- Image OCR to markdown/text/JSON
- PDF extraction with AI cleanup
- Document cleaning/sanitization

## Key Features

1. **Quality Presets**: lossless, high, medium, low, web
2. **AI Cleanup**: `--clean` flag sanitizes output with AI
3. **Large File Chunking**: Automatic splitting for files >10MB
4. **Batch Processing**: Convert entire directories

## Use Cases

1. **Image Optimization**: Compress images for web
2. **Document Extraction**: OCR scanned documents
3. **Data Transformation**: Convert between data formats
4. **PDF Processing**: Extract/convert PDF content
