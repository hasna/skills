---
name: pitch-deck
description: Generate premium investor or sales pitch deck packages with PPTX, PDF, notes, and design direction.
---

# Pitch Deck

Generate investor or sales deck packages from a short brief.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run pitch-deck --brief "AI support desk for Shopify merchants" --company "Acme" --audience investors
skills run pitch-deck "Usage-based billing platform for AI SaaS" --slides 12 --tone bold
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--brief <text>` | Company, product, offer, or campaign brief. Positional text also works. | required |
| `--company <name>` | Company or product name. | Company |
| `--audience <type>` | `investors`, `sales`, or `internal`. | investors |
| `--slides <number>` | Number of slides, 5-15. | 10 |
| `--tone <tone>` | `concise`, `bold`, or `technical`. | concise |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `deck.md`
- `deck.pdf`
- `deck.pptx`
- `slides.json`
- `speaker-notes.md`
- `design-direction.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
