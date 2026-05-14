---
name: brand-kit
description: Generate premium brand kits with logo usage, palette, typography, brand voice, sample applications, Markdown guide, and PDF guide.
---

# Brand Kit

Generate a production-ready brand guide package for a startup, product, internal tool, or campaign.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills run brand-kit "Usage-based billing for AI SaaS" --audience "founders" --personality "precise, calm, pragmatic"
skills run brand-kit --brand "Acme Ledger" --category "developer tools" --tone premium
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--brand <text>` | Brand, product, or company name. Positional text also works. | required |
| `--category <text>` | Market category or product type. | software product |
| `--audience <text>` | Primary audience. | software teams |
| `--personality <text>` | Brand personality words. | clear, capable, direct |
| `--tone <tone>` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `brand-guide.md`
- `brand-guide.pdf`
- `palette.json`
- `typography.md`
- `voice-guide.md`
- `logo-usage.md`
- `sample-applications.md`
- `brand-assets.svg`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
