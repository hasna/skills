---
name: read-csv
description: Parse CSV files into structured JSON with delimiter auto-detection, header handling, common encoding support, and streaming reads for large files.
---

# Read CSV

Parse CSV files from disk and return structured JSON that is easy to inspect, transform, or hand to another tool.

## Features

- Delimiter auto-detection for comma, tab, semicolon, and pipe
- Header detection with `auto`, `true`, and `false` modes
- Common encoding support (`utf8`, `utf16le`, `utf16be`, `latin1`, `win1252`)
- Streaming parser for large files
- Optional row limits and file output

## Usage

```bash
# Parse a CSV with auto-detected headers and delimiter
skill-read-csv --input ./customers.csv

# Force tab-delimited parsing and save output
skill-read-csv --input ./report.tsv --delimiter tab --output ./report.json

# Parse with explicit header handling
skill-read-csv --input ./raw.csv --headers false

# Preview the first 100 rows only
skill-read-csv --input ./large.csv --limit 100
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path>` | CSV file to parse | required |
| `-d, --delimiter <value>` | Delimiter (`comma`, `tab`, `semicolon`, `pipe`, or literal character) | auto |
| `-e, --encoding <value>` | Input encoding (`auto`, `utf8`, `utf16le`, `utf16be`, `latin1`, `win1252`) | auto |
| `--headers <mode>` | Header mode: `auto`, `true`, `false` | auto |
| `-l, --limit <n>` | Stop after parsing `n` rows | unlimited |
| `-o, --output <path>` | Save JSON result to a file | stdout |
| `--help` | Show usage | |
| `--version` | Show version | |

## Output Shape

```json
{
  "input": "/absolute/path/to/file.csv",
  "encoding": "utf8",
  "delimiter": ",",
  "hasHeader": true,
  "columns": ["id", "email", "plan"],
  "rowCount": 2,
  "truncated": false,
  "rows": [
    { "id": "1", "email": "a@example.com", "plan": "pro" }
  ]
}
```
