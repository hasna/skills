---
name: skill-read-excel
description: Parse XLS and XLSX workbooks into structured JSON with sheet metadata, named ranges, and formatted cell snapshots.
---

# Read Excel

Parse Excel workbooks from disk and return structured JSON for one or more sheets.

## Features

- Supports `.xls` and `.xlsx`
- Reads multiple sheets in one run
- Returns workbook metadata, named ranges, and per-sheet rows
- Preserves sheet order and includes formatted cell snapshots
- Allows limiting rows for large workbooks

## Usage

```bash
# Parse all sheets
skill-read-excel --input ./forecast.xlsx

# Restrict to specific sheets
skill-read-excel --input ./ops.xls --sheets Summary,Costs

# Limit output and save it
skill-read-excel --input ./audit.xlsx --limit 100 --output ./audit.json
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path>` | Excel workbook to parse | required |
| `-s, --sheets <list>` | Comma-separated sheet names to include | all sheets |
| `-l, --limit <n>` | Limit rows returned per sheet | unlimited |
| `-o, --output <path>` | Save JSON result to a file | stdout |
| `--help` | Show usage | |
| `--version` | Show version | |

## Output Shape

```json
{
  "input": "/absolute/path/to/workbook.xlsx",
  "workbook": {
    "sheetNames": ["Summary", "Data"],
    "namedRanges": []
  },
  "sheets": [
    {
      "name": "Summary",
      "index": 0,
      "rowCount": 12,
      "columnCount": 4,
      "columns": ["month", "revenue", "cost"],
      "rows": [
        { "month": "Jan", "revenue": 1000, "cost": 600 }
      ]
    }
  ]
}
```
