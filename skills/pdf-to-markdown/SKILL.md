---
name: pdf-to-markdown
description: Convert PDFs into clean markdown through the hosted Skills runtime.
---

# PDF to Markdown

Convert a PDF into clean, structured markdown using the hosted Skills runtime. The implementation runs remotely so local agent installs only need this usage contract; no parser source, scripts, or hosted runtime code is copied to the user's machine.

## What It Does

- Extracts text, headings, lists, and tables from PDFs.
- Preserves useful page boundaries and source references.
- Cleans noisy extraction output into readable markdown.
- Supports selected page ranges for large documents.
- Uses the platform runtime for paid execution and billing.

## Runtime

This is a premium remote skill. The hosted runtime handles extraction and cleanup after deterministic PDF processing. Agents should run it through Skills MCP or the CLI, not through copied local source.

## Usage

```bash
skills run pdf-to-markdown --input ./report.pdf --output ./report.md
```

```bash
skills run pdf-to-markdown --input ./contract.pdf --pages 1-5,12 --preserve-pages
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--input <path-or-url>` | PDF file path or URL | required |
| `--pages <ranges>` | Page ranges like `1-5,8,10-12` | all pages |
| `--output <path>` | Save markdown to a file | stdout |
| `--preserve-pages` | Include page boundary comments | false |
| `--table-mode <mode>` | `markdown` or `html` table output | markdown |

## Requirements

- Authenticate with `skills auth login`.
- Keep the Skills MCP server registered with your agent:

```bash
skills setup agents
```
