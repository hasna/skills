---
name: Analyze Data
version: 0.1.0
description: Instant data science insights for CSV and JSON files with statistical summaries, quality audits, and trend detection
author: skills.md
category: Data & Analytics
tags:
  - data
  - analytics
  - statistics
  - csv
  - json
  - insights
  - quality-assurance
credits: 5
---

# Analyze Data

Instant data science insights for your CSV and JSON files. Automatically generates comprehensive reports including statistical summaries, data quality audits, correlation matrices, and trend detection without sending your data to external APIs.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Features

- **Statistical Profiling**: Calculates mean, median, mode, standard deviation, quartiles, and custom percentiles for all numeric columns.
- **Data Quality Audit**: Detects missing values, duplicates, mixed data types, and outliers to assess dataset health.
- **Correlation Discovery**: Identifies relationships between variables using Pearson correlation coefficients.
- **Trend Detection**: Automatically spots time-series patterns, seasonality, and growth trends.
- **Visualization Ready**: Recommends the best chart types (histograms, line charts, scatter plots) based on data distribution.
- **Multi-Format Reports**: Exports findings as interactive HTML, structured JSON, or readable Markdown.
- **Scalable**: Efficiently processes large files using stream processing and sampling options.

## Usage

```bash
skills run analyze-data -- <file-path> [options]
```

## Options

| Option          | Description                                                  | Default              |
| --------------- | ------------------------------------------------------------ | -------------------- |
| `--format`      | Output format: `markdown`, `json`, or `html`                 | `markdown`           |
| `--output`      | Save report to file path                                     | (prints to console)  |
| `--correlations`| Calculate correlation matrix for numeric columns             | `false`              |
| `--outliers`    | Detect and report outliers using IQR method                  | `false`              |
| `--trends`      | Analyze trends if time-series data is detected               | `false`              |
| `--sample`      | Analyze only the first N rows (for large files)              | (all rows)           |
| `--percentiles` | Custom percentiles to calculate (comma-separated)            | `25,50,75,90,95`     |
| `--verbose`     | Show detailed processing logs                                | `false`              |

## Examples

### Quick Health Check
```bash
# Analyze a CSV file and print report to console
skills run analyze-data -- sales-data.csv
```

### Deep Dive Analysis
```bash
# Full analysis with correlations, outliers, and HTML report
skills run analyze-data -- dataset.csv \
  --correlations \
  --outliers \
  --format html \
  --output report.html
```

### Large File Sampling
```bash
# Quickly analyze the first 10,000 rows of a large dataset
skills run analyze-data -- huge-log-file.json \
  --sample 10000 \
  --verbose
```

### JSON Export for Pipelines
```bash
# Generate JSON stats for downstream processing
skills run analyze-data -- metrics.json \
  --format json \
  --output analysis.json
```

## Report Sections

1.  **Dataset Overview**: File size, row/column counts, memory usage.
2.  **Column Analysis**: Data types, unique values, null counts, and sample data.
3.  **Statistical Summary**: Detailed metrics for numeric columns (mean, std dev, etc.).
4.  **Data Quality**: Quality score (0-100), missing data summary, and duplicate detection.
5.  **Correlations**: (Optional) Matrix of relationships between variables.
6.  **Trends**: (Optional) Time-series patterns and anomalies.
7.  **Visualization Recommendations**: Suggested charts for exploring the data.
8.  **Key Insights**: Auto-generated observations about the dataset.

## Supported Formats

- **CSV**: Standard comma-separated, TSV, and custom delimiters.
- **JSON**: Arrays of objects or objects containing data arrays.

## Performance

- **Small (<10MB)**: Instant analysis.
- **Medium (10-100MB)**: 2-10 seconds.
- **Large (>100MB)**: Use `--sample` for best performance.

## Requirements

- Bun runtime.
- No external API keys required (runs locally).