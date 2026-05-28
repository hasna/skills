---
name: pdf-to-dataset
description: Extract tables, forms, invoices, and semi-structured PDF content into CSV and JSON datasets through the hosted Skills runtime.
---

# PDF to Dataset

Convert PDF content into structured datasets and extraction reports. The implementation runs through the hosted Skills runtime, so agents get the instruction file and generated artifacts without receiving parser source, scripts, or model code.

## What It Does

- Extracts table-like rows, key-value fields, invoice fields, and semi-structured records from PDFs.
- Produces `dataset.json`, `dataset.csv`, `schema.json`, `extraction-report.md`, and `manifest.json`.
- Includes confidence notes and source metadata for review.
- Supports schema hints for naming columns and expected fields.
- Stores generated outputs as run artifacts for later download.

## Usage

```bash
skills run pdf-to-dataset -- --input ./invoice.pdf --schema "invoice_number,date,total,vendor"
```

```bash
skills run pdf-to-dataset -- --input ./reports --mode tables --output ./exports/pdf-data
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--input <path-or-url>` | PDF file, folder, or URL | required |
| `--schema <fields>` | Comma-separated field hints | inferred |
| `--mode <mode>` | `tables`, `forms`, `invoice`, or `auto` | auto |
| `--output <dir>` | Output directory | current run export directory |
| `--pages <ranges>` | Page ranges like `1-3,8` | all pages |

## Requirements

- Authenticate with `skills auth login`.
- Keep the Skills MCP server registered with your agent:

```bash
skills mcp --register all
```
