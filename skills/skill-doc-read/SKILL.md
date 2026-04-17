---
name: Doc Read
version: 0.1.0
description: Read and extract text from DOCX files with section parsing, metadata extraction, and multiple file support
category: Data & Analysis
tags:
  - docx
  - documents
  - extraction
  - reader
  - word
---

# Doc Read

Read and extract content from DOCX files. Supports multiple files at once, preserves document structure (headings, paragraphs, lists, tables), and extracts metadata. Outputs plain text, JSON with structure, or markdown.

## Features

- **Multiple Files**: Process many DOCX files in a single command
- **Structure Preservation**: Extracts headings, paragraphs, lists, and tables
- **Metadata Extraction**: Get title, author, creation date, word count
- **Parallel Processing**: Process multiple files concurrently
- **Output Formats**: Plain text, JSON with document structure, or markdown

## Usage

```bash
# Read a single DOCX file
skill-doc-read read document.docx

# Read multiple files
skill-doc-read read file1.docx file2.docx file3.docx

# Output as JSON with structure
skill-doc-read read document.docx --format json --output result.json

# Get metadata only
skill-doc-read info document.docx
```

## Requirements

- Bun runtime
- mammoth (auto-installed)
