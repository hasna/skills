---
name: Budget Variance Analyzer
version: 0.1.0
description: Explain budget versus actual variances with performance insights, key drivers, and recommended actions
author: skills.md
category: Finance
tags:
  - budgeting
  - financial-analysis
  - variance-reporting
  - fpa
  - performance-metrics
  - ai-analyst
credits: 3
---

# Budget Variance Analyzer

Automate your monthly financial reporting. Feed in budget vs. actuals data, and this skill acts as an FP&A analyst to identify key variance drivers, assess risks, and draft executive-ready commentary. It doesn't just calculate the difference; it explains *why* the numbers are off and what to do about it.

## Features

- **Driver Identification**: Pinpoints the specific line items causing the biggest deviations.
- **Risk Assessment**: Classifies variances as "Risks" or "Opportunities" based on impact.
- **Action Planning**: Suggests corrective actions (e.g., "Freeze hiring," "Reallocate spend") for each issue.
- **Audience Tailoring**: Adjusts the report depth for CFOs (high-level) vs. Department Heads (granular).
- **Threshold Filtering**: Focuses analysis only on variances exceeding your defined % or $ limits.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Usage

```bash
# Analyze a variance report file
skills run budget-variance-analyzer -- "./inputs/budget_variance.csv"
  --period "November 2025"

# Analyze inline data
skills run budget-variance-analyzer -- --text "Marketing: Budget 120k, Actual 138k. Sales: Budget 300k, Actual 270k"
  --audience "Finance Team"

# Set a strict threshold
skills run budget-variance-analyzer -- "./inputs/q4_report.json"
  --threshold "5%"
  --format markdown
```

## Options

| Option        | Description                                          | Default        |
| ------------- | ---------------------------------------------------- | -------------- |
| `--text`      | Raw data text (if not using file input)              | -              |
| `--period`    | Reporting period (e.g. "Q4 2024")                    | current period |
| `--audience`  | Target audience (`Finance`, `Exec`, `Dept`)          | Finance        |
| `--threshold` | Variance threshold to trigger analysis (e.g. "5%")   | 5%             |
| `--currency`  | Currency symbol for display                          | USD            |
| `--format`    | Output format (`markdown` or `json`)                 | markdown       |
| `--output`    | Custom filename for export                           | Auto-generated |

## Output

- **Report**: A structured variance analysis document.
- **Action Items**: A list of recommended next steps.

## Examples

### Executive Summary
```bash
skills run budget-variance-analyzer -- "./inputs/pnl_summary.csv"
  --audience "Executive Team"
  --threshold "10%"
```

### Department Review
```bash
skills run budget-variance-analyzer -- --text "Engineering: Budget 500k, Actual 550k (Cloud costs spike)"
  --audience "Engineering Director"
```

## Requirements

- `OPENAI_API_KEY` environment variable.
- Bun runtime.