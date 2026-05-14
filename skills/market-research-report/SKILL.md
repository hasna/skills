---
name: market-research-report
description: Generate a premium market research report with competitor, audience, pricing, source, Markdown, and PDF artifacts.
---

# Market Research Report

Generate a market research report package for SaaS, developer tools, and business planning work.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run market-research-report --topic "AI developer tools" --audience "SaaS founders" --competitors "Cursor,Copilot,Replit"
skills run market-research-report "B2B onboarding analytics" --region "US/EU" --format strategic
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--topic <text>` | Market, product category, or research question. Positional text also works. | required |
| `--audience <text>` | Target audience or buyer segment. | Operators and founders |
| `--competitors <list>` | Comma-separated competitor names. | inferred examples |
| `--region <text>` | Geographic or commercial scope. | Global |
| `--format <format>` | `strategic`, `investor`, or `product`. | strategic |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `market-research-report.md`
- `market-research-report.pdf`
- `competitors.csv`
- `sources.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
