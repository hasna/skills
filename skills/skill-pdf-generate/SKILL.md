---
name: Generate Pdf
version: 0.1.0
description: Generate high-quality PDF documents from markdown, HTML, or templates
category: Productivity
tags:
  - pdf
  - document
  - generation
  - reports
  - invoices
  - contracts
  - conversion
  - automation
author: skills.md
license: MIT
compatibility:
  - claude-code
  - openai-codex
---

# Generate PDF

Turn anything into a PDF. Convert Markdown, HTML, or plain text into polished PDF documents. Includes templates for reports, contracts, and resumes with custom headers and footers. Perfect for generating official docs on the fly.

## Features

- **Format Conversion**: Turns Markdown/HTML into professional PDFs.
- **Templates**: Built-in layouts for Invoices, Reports, Resumes, and Letters.
- **Web Capture**: Converts any URL into a PDF document.
- **Customization**: Supports custom CSS, margins, page sizes (A4, Letter), and orientation.
- **Headers/Footers**: Adds page numbers, dates, and titles automatically.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Usage

```bash
# Convert markdown file
skills run generate-pdf -- --file report.md --format A4

# Generate from template
skills run generate-pdf/template -- \
  --template invoice \
  --data '{"companyName":"Acme","total":"$1000"}'

# Capture a webpage
skills run generate-pdf/fromUrl -- --url https://example.com
```

## Options

| Option       | Description                                      | Default   |
| ------------ | ------------------------------------------------ | --------- |
| `--file`     | Input file path                                  | -         |
| `--content`  | Inline content string                            | -         |
| `--format`   | Page size (`A4`, `Letter`, `Legal`)              | A4        |
| `--template` | Use a preset (`invoice`, `report`, `resume`)     | -         |
| `--url`      | Webpage URL to capture                           | -         |
| `--output`   | Custom output filename                           | (auto)    |

## Output

- **PDF File**: The generated document.
- **Metadata**: Details about the generation process.

## Examples

### Contract Generation
```bash
skills run generate-pdf/template -- \
  --template contract \
  --data '{"party1":"Alice", "party2":"Bob", "date":"2025-10-01"}' \
  --filename contract_signed.pdf
```

### Documentation Build
```bash
skills run generate-pdf -- --file README.md \
  --css "body { font-family: Helvetica; }" \
  --header "Project Documentation"
```

## Requirements

- Bun runtime.