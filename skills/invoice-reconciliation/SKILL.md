---
name: invoice-reconciliation
description: Reconcile invoice and payment CSV exports into matched rows, short/over payments, duplicates, unpaid invoices, orphan payments, anomaly notes, and per-bucket totals.
---

# Invoice Reconciliation

Join an invoice CSV against a payment CSV on invoice id and classify every row.
Everything runs locally and deterministically: no network calls, no credentials,
no model calls. The judgement calls (are two payments instalments or a genuine
duplicate?) are surfaced as anomalies for a human or agent to decide.

## What It Does

- Detects the id, amount, date, and counterparty columns in each CSV, tolerating naming variation (`invoice_id` / `Invoice Number` / `ref`, `amount` / `Amount Due` / `total`, `date` / `paid_at` / `Issue Date`).
- Matches invoice ids case- and whitespace-insensitively (`INV-1006 ` matches `inv-1006`).
- Parses money robustly: `$`, `€`, thousands separators, `1.234,56` European decimals, and `(1,234.00)` negatives.
- Classifies each invoice into `matched`, `short-paid`, `over-paid`, `duplicate-payment`, `unpaid-invoice`, or `orphan-payment` (payment with no invoice).
- Sums multiple payments per invoice and flags identical payment rows (same amount and date).
- Reports counts, invoiced, paid, and difference totals per bucket, plus a match rate.

## Requirements

- [Bun](https://bun.sh) 1.x
- npm dependencies: `csv-parse`, `csv-stringify` (install once with `bun install` in this skill directory)
- Two CSV files: one with invoice rows, one with payment rows. Each needs an invoice id column and an amount column; date and counterparty columns are optional.

## Usage

```bash
# Default reconciliation into ./reconciliation
skills run invoice-reconciliation -- --invoices ./invoices.csv --payments ./payments.csv

# Allow a 1.00 rounding tolerance and label amounts in EUR
skills run invoice-reconciliation -- --invoices ./invoices.csv --payments ./payments.csv \
  --tolerance 1 --currency EUR --output ./out/june-close

# Machine-readable summary (buckets, totals, anomalies) on stdout
skills run invoice-reconciliation -- --invoices ./invoices.csv --payments ./payments.csv --json
```

Run it directly from the skill directory with
`bun run src/index.ts --invoices ./invoices.csv --payments ./payments.csv`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --invoices <path>` | CSV export with invoice rows | required |
| `-p, --payments <path>` | CSV export with payment rows | required |
| `-o, --output <dir>` | Output directory | `./reconciliation` |
| `-t, --tolerance <n>` | Absolute amount difference still counted as matched | `0.01` |
| `-c, --currency <code>` | Currency label used in the summary | `USD` |
| `--json` | Print the summary (with anomalies) as JSON on stdout | off |
| `--help` | Show usage | |
| `--version` | Show version | |

## Classification Rules

| Status | Meaning |
|--------|---------|
| `matched` | Exactly one payment and `abs(paid - invoiced) <= tolerance` |
| `short-paid` | Paid less than invoiced beyond the tolerance |
| `over-paid` | Paid more than invoiced beyond the tolerance |
| `duplicate-payment` | Two or more payment rows share the invoice id |
| `unpaid-invoice` | Invoice with no matching payment row |
| `orphan-payment` | Payment whose id matches no invoice row |

## Outputs

Written into `--output` (default `./reconciliation`):

| File | Contents |
|------|----------|
| `matched.csv` | Invoices settled within the tolerance |
| `discrepancies.csv` | Every non-matched row with amounts, difference, and a note |
| `anomalies.json` | Duplicate invoice rows, multiple/identical payments, orphan payments, missing ids, unparseable amounts |
| `summary.json` | Detected columns, per-bucket counts and totals, match rate, run metadata |

A summary table is printed to stdout:

```
  bucket             count  invoiced      paid  difference
  -----------------  -----  --------  --------  ----------
  matched                2   1299.99   1299.99        0.00
  short-paid             1    850.50    800.00      -50.50
  over-paid              1   2400.00   2500.00      100.00
  duplicate-payment      1  15000.00  15000.00        0.00
  unpaid-invoice         1    320.00      0.00     -320.00
  orphan-payment         1      0.00    450.00      450.00
  -----------------  -----  --------  --------  ----------
  TOTAL                  7  19870.49  20049.99      179.50
```

## Exit Codes

- `0` — reconciliation completed
- `1` — missing/unreadable CSV, unparseable CSV, or no id/amount column could be detected
