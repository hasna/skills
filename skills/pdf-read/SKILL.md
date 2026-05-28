---
name: pdf-read
version: 0.1.0
description: Read and extract text from multiple PDF files with page-range selection and parallel processing
category: Data & Analysis
tags:
  - pdf
  - documents
  - extraction
  - analysis
  - reader
---

# PDF Read

Read and extract text from PDF files. Supports multiple PDFs at once, page-range selection, chunked reading for large files, and parallel processing. Outputs text, JSON, or structured markdown.

## Features

- **Multiple PDFs**: Process many PDFs in a single command
- **Page Ranges**: Read specific pages (e.g., `1-5`, `3,7,10-15`)
- **Chunked Reading**: Break large PDFs into manageable chunks
- **Parallel Processing**: Process multiple files concurrently
- **Metadata Extraction**: Get page count, author, title, dates
- **Output Formats**: Plain text, JSON with page structure, or markdown

## Usage

```bash
# Read entire PDF
skills run pdf-read -- read document.pdf

# Read specific pages
skills run pdf-read -- read report.pdf --pages 1-5

# Read multiple PDFs
skills run pdf-read -- read file1.pdf file2.pdf file3.pdf

# Read in chunks of 10 pages
skills run pdf-read -- read large-book.pdf --chunk-size 10

# Get metadata only
skills run pdf-read -- info document.pdf

# Output as JSON with page structure
skills run pdf-read -- read document.pdf --format json --output result.json
```

## Runtime

This is a premium remote skill. Authenticate with `skills auth login` and run it through Skills MCP or `skills run`.

## Requirements

- Skills CLI/MCP registration
- Hosted Skills runtime access
