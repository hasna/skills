---
name: invoice-reconciliation
description: Generate premium invoice reconciliation reports from invoice, payment, purchase order, or CSV/XLSX-style exports with matches, discrepancies, anomaly notes, summaries, and manifest metadata.
---

# Invoice Reconciliation

Generate a reconciliation package from invoice and payment exports. The hosted run produces matched rows, discrepancy tables, anomaly notes, and a management-ready report.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run invoice-reconciliation --invoices ./invoices.csv --payments ./payments.csv --company "Acme"
skills run invoice-reconciliation --data "invoice_id,customer,amount,status\nINV-1,Acme,1200,open" --currency USD
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--invoices <path>` | CSV export with invoice rows. | optional |
| `--payments <path>` | CSV export with payment rows. | optional |
| `--data <text>` | Inline invoice/payment CSV-style data. Positional text also works. | optional |
| `--company <text>` | Company or finance workspace name. | Company |
| `--currency <code>` | Currency code for output amounts. | USD |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `reconciliation-report.md`
- `matched-invoices.csv`
- `discrepancies.csv`
- `anomalies.json`
- `summary.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
