---
name: pdf-to-markdown
description: Convert PDFs into clean, structured markdown with heading detection, list normalization, table reconstruction, running header/footer removal, and page range selection.
---

# PDF to Markdown

Convert a text-based PDF into readable markdown. Extraction runs locally with
`pdf-parse`; no network calls and no credentials are involved.

## What It Does

- Rebuilds each page's visual layout (x/y positions) so columns and indentation survive extraction.
- Infers heading levels from relative font size, with a shape heuristic (short, title-cased, preceded by a gap) for documents that use a single font size.
- Normalizes `-`, `*`, `•` and `1.` / `1)` lists into markdown lists.
- Reconstructs aligned columns into markdown tables.
- Strips running headers/footers: edge lines that repeat on more than half the pages, plus bare page numbers and `Page N of M`.
- Reflows wrapped prose lines back into paragraphs, while keeping short `Label: value` fields on their own lines.
- Selects page ranges and can emit `<!-- page N -->` boundary comments.

## Requirements

- [Bun](https://bun.sh) 1.x
- npm dependency: `pdf-parse` (install once with `bun install` in this skill directory)
- A text-based PDF. Scanned/image-only PDFs contain no extractable text; the skill exits with a clear error instead of guessing.

## Usage

```bash
# Print markdown to stdout
skills run pdf-to-markdown -- --input ./report.pdf

# Write markdown to a file
skills run pdf-to-markdown -- --input ./report.pdf --output ./report.md

# Convert a page range and keep page boundaries
skills run pdf-to-markdown -- --input ./contract.pdf --pages 1-5,12 --preserve-pages

# Machine-readable envelope (markdown + headings + stats)
skills run pdf-to-markdown -- --input ./report.pdf --json
```

Run it directly from the skill directory with `bun run src/index.ts --input ./report.pdf`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path>` | PDF file to convert (also accepted positionally) | required |
| `-o, --output <path>` | Write markdown to a file | stdout |
| `-p, --pages <ranges>` | Page selection such as `1-5,8,12` | all pages |
| `--preserve-pages` | Emit `<!-- page N -->` boundary comments | off |
| `--no-reflow` | Keep original hard line breaks instead of rejoining wrapped lines | off |
| `--no-tables` | Do not convert aligned columns into markdown tables | off |
| `--keep-repeats` | Keep running headers/footers instead of stripping them | off |
| `--json` | Print a JSON envelope instead of raw markdown | off |
| `--help` | Show usage | |
| `--version` | Show version | |

## Outputs

- Markdown on stdout, or the file given by `--output`.
- With `--output`, a one-line summary (pages converted, headings, tables, characters) is printed to stdout.
- With `--json`, an envelope:

```json
{
  "input": "/abs/path/report.pdf",
  "totalPages": 3,
  "convertedPages": [1, 2, 3],
  "headings": [{ "level": 1, "text": "Quarterly Platform Report", "page": 1 }],
  "droppedRepeats": ["ACME CORP CONFIDENTIAL", "Page 1 of 3"],
  "stats": { "lines": 24, "paragraphs": 3, "bullets": 3, "tables": 1, "characters": 812 },
  "markdown": "# Quarterly Platform Report\n..."
}
```

## Exit Codes

- `0` — conversion succeeded
- `1` — missing/unreadable input, not a PDF, unparseable PDF, or no extractable text
