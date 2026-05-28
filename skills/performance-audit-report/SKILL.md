---
name: performance-audit-report
description: Generate premium performance audit reports for web apps, APIs, or SaaS surfaces with metrics, findings, budgets, remediation plans, and manifest metadata.
---

# Performance Audit Report

Generate a performance audit package from a URL, repo notes, trace summary, or product brief. Hosted runs can gather richer measurements, while local direct execution produces deterministic artifacts for validation.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run performance-audit-report --target "https://skills.md" --app "Skills.md"
skills run performance-audit-report --notes "Dashboard JS is 1.2MB and API p95 is 900ms" --surface web
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url-or-path>` | App URL, route, repo path, or service name. | optional |
| `--notes <text>` | Performance notes, metrics, trace summary, or constraints. Positional text also works. | optional |
| `--app <text>` | Application or product name. | Performance Target |
| `--surface <type>` | `web`, `api`, `mobile`, or `worker`. | web |
| `--budget <profile>` | `strict`, `balanced`, or `growth`. | balanced |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `performance-audit-report.md`
- `findings.csv`
- `performance-budget.json`
- `remediation-plan.md`
- `metrics.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
