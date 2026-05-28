---
name: contract-review-report
description: Generate premium contract review reports with clause summaries, risk register, negotiation points, redline-style suggestions, counterparty email draft, and manifest metadata.
---

# Contract Review Report

Generate a structured contract review package from an agreement, terms sheet, statement of work, vendor contract, or customer contract.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run contract-review-report --source ./msa.txt --party "Acme" --counterparty "VendorCo"
skills run contract-review-report --contract "Termination requires 90 days notice..." --focus "privacy,liability,payment"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--contract <text>` | Contract text. Positional text also works. | required unless `--source` is used |
| `--source <path>` | Read contract text from a file. | none |
| `--party <text>` | Your company or client name. | Our company |
| `--counterparty <text>` | Other party name. | Counterparty |
| `--jurisdiction <text>` | Governing context for notes. | Not specified |
| `--focus <list>` | Comma-separated focus areas. | liability,payment,termination,privacy |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `contract-review-report.md`
- `risk-register.csv`
- `clause-summary.json`
- `redline-suggestions.md`
- `negotiation-email.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
