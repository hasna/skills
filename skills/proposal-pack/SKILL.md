---
name: proposal-pack
description: Generate premium client proposal packages with proposal, SOW, pricing, timeline, assumptions, cover email, Markdown, and PDF artifacts.
---

# Proposal Pack

Generate a client-ready proposal package for agencies, consultants, SaaS services, and implementation teams.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run proposal-pack --client "Acme" --project "AI onboarding workflow" --budget "25k USD" --timeline "6 weeks"
skills run proposal-pack "Revamp the customer onboarding portal" --services "Discovery,Design,Build,Training"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--project <text>` | Project scope or proposal brief. Positional text also works. | required |
| `--client <name>` | Client or account name. | Client |
| `--budget <text>` | Budget range or fixed price. | To be confirmed |
| `--timeline <text>` | Delivery timeline. | 4-6 weeks |
| `--services <list>` | Comma-separated services or workstreams. | discovery, implementation, enablement |
| `--tone <tone>` | `executive`, `friendly`, or `technical`. | executive |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `proposal.md`
- `proposal.pdf`
- `statement-of-work.md`
- `pricing.csv`
- `timeline.csv`
- `assumptions.md`
- `cover-email.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
