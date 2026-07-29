---
name: pdf-to-dataset
description: Extract tables and Label/value form fields from PDFs into CSV and JSON datasets with an inferred schema, per-page findings, and heuristic confidence notes.
---

# PDF to Dataset

Turn a text-based PDF into a structured dataset. Extraction runs locally with
`pdf-parse`; no network calls and no credentials are involved.

## What It Does

- Rebuilds each page's visual layout (x/y positions) so column gaps survive text extraction.
- **Tables mode** — groups consecutive lines that share a whitespace-separated column layout, detects a header row (unique, mostly non-numeric cells above typed data), pads ragged rows, and names columns `snake_case`.
- **Forms mode** — collects `Label: value` pairs, including several pairs on one line separated by wide gaps.
- **Auto mode** — uses tables when any table block is found, otherwise falls back to form fields.
- Infers a column type per field: `string`, `number` (currency symbols, thousands separators and `(1,234)` negatives tolerated), `date`, or `empty`.
- Scores every table with a transparent heuristic confidence and explains the score in the report.

## Requirements

- [Bun](https://bun.sh) 1.x
- npm dependencies: `pdf-parse`, `csv-stringify` (install once with `bun install` in this skill directory)
- A text-based PDF. Scanned/image-only PDFs contain no extractable text; the skill exits with a clear error.

## Usage

```bash
# Auto-detect tables or form fields
skills run pdf-to-dataset -- --input ./report.pdf

# Force table extraction from a page range
skills run pdf-to-dataset -- --input ./report.pdf --mode tables --pages 2-4

# Invoice-style key/value extraction into a chosen directory
skills run pdf-to-dataset -- --input ./invoice.pdf --mode forms --output ./exports/invoice

# Machine-readable summary on stdout
skills run pdf-to-dataset -- --input ./report.pdf --json
```

Run it directly from the skill directory with `bun run src/index.ts --input ./report.pdf`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path>` | PDF file to extract (also accepted positionally) | required |
| `-o, --output <dir>` | Output directory | `./pdf-dataset` |
| `-m, --mode <mode>` | `tables`, `forms`, or `auto` | `auto` |
| `-p, --pages <ranges>` | Page selection such as `1-3,8` | all pages |
| `--min-rows <n>` | Minimum lines for a block to count as a table | `2` |
| `--json` | Print the extraction summary as JSON on stdout | off |
| `--help` | Show usage | |
| `--version` | Show version | |

## Outputs

Written into `--output` (default `./pdf-dataset`):

| File | Contents |
|------|----------|
| `dataset.json` | Every detected table and form page, plus the flattened `records` list |
| `dataset.csv` | The primary (largest) table, or one row per form page in forms mode |
| `schema.json` | Inferred column names, types, fill counts, and sample values |
| `extraction-report.md` | Per-page findings table, per-table notes, and confidence notes |

Without `--json`, a summary table is printed to stdout:

```
pdf-to-dataset: /abs/path/report.pdf
  mode           auto -> tables
  pages scanned  3/3
  tables found   1
  form pages     1
  records        4
    table-1 (page 2): 4 rows x 4 cols, confidence 0.85
  output         /abs/path/pdf-dataset
  files          dataset.json, dataset.csv, schema.json, extraction-report.md
```

Confidence is a documented heuristic (header detection + cell fill rate + typed columns + row
count), not a model score. Review low-confidence tables against the source PDF.

## Exit Codes

- `0` — extraction completed (even if nothing was found; the report says so)
- `1` — missing/unreadable input, not a PDF, unparseable PDF, or no extractable text
