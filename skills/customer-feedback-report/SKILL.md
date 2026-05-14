---
name: customer-feedback-report
description: Generate premium customer feedback reports from reviews, support tickets, surveys, call notes, or raw feedback with clusters, sentiment, root causes, roadmap recommendations, evidence, and manifest metadata.
---

# Customer Feedback Report

Generate a structured customer feedback insight package from reviews, support tickets, survey responses, interview notes, sales call notes, or mixed raw feedback.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run customer-feedback-report --feedback "Users love onboarding but struggle with invoices and integrations" --product "Skills.md"
skills run customer-feedback-report ./feedback.txt --product "Acme CRM" --channel tickets --format product
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--feedback <text>` | Raw feedback text. Positional text also works. | required unless `--source` is used |
| `--source <path>` | Read feedback text from a file. | none |
| `--product <text>` | Product, service, or workflow name. | Product |
| `--segment <text>` | Customer segment or audience. | All customers |
| `--channel <type>` | `reviews`, `tickets`, `calls`, `surveys`, or `mixed`. | mixed |
| `--format <type>` | `product`, `support`, or `executive`. | product |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `customer-feedback-report.md`
- `customer-feedback-report.pdf`
- `feedback-clusters.csv`
- `roadmap-suggestions.md`
- `sentiment-summary.json`
- `evidence.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
