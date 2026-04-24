---
name: excel
version: 0.1.0
description: Generate Excel spreadsheets with tables, formulas, multiple sheets, styling, and optional AI-generated data.
category: Content Generation
tags:
  - excel
  - spreadsheet
  - xlsx
  - generation
  - data
---

# Excel

Generate `.xlsx` spreadsheets or CSV exports from templates, prompt-provided data, or AI-generated sample data. Use this when the user needs a workbook, budget, invoice sheet, report table, tracker, or structured spreadsheet file.

## Usage

```bash
skill-excel --preset budget --rows 12 --output ./budget.xlsx
skill-excel --prompt "Create a weekly content calendar" --output ./calendar.xlsx
skill-excel --format csv --preset invoice --output ./invoice.csv
```

## Inputs

- `--preset <name>`: use a built-in workbook template such as `budget`, `invoice`, or `tracker`
- `--prompt <text>`: ask AI to generate spreadsheet data
- `--rows <n>`: number of rows to create
- `--sheets <names>`: comma-separated sheet names
- `--format <xlsx|csv>`: output format
- `--output <path>`: output file path

## Requirements

- `OPENAI_API_KEY` is required only when using prompt-based AI data generation.
- Local template generation does not need network access.
