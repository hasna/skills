---
name: one-page-website
description: Generate premium static one-page website bundles with HTML, CSS, JavaScript, copy, section map, deploy notes, and manifest.
---

# One Page Website

Generate a complete static one-page website bundle for a SaaS product, service, launch, waitlist, portfolio offer, or internal tool.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run one-page-website "Usage-based billing for AI SaaS" --name "MeterKit" --audience "founders"
skills run one-page-website --brief "Customer feedback analytics" --goal "join the waitlist" --style "sharp and editorial"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--brief <text>` | Product, service, or website brief. Positional text also works. | required |
| `--name <text>` | Brand or page name. | derived from brief |
| `--audience <text>` | Target visitor. | software teams |
| `--goal <text>` | Primary conversion goal. | book a demo |
| `--style <text>` | Visual and voice direction. | polished SaaS, crisp UI, confident copy |
| `--proof <text>` | Proof points or trust signals. | customer outcomes and workflow proof |
| `--sections <list>` | Comma-separated sections. | hero,features,proof,pricing,faq,cta |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `site/index.html`
- `site/styles.css`
- `site/script.js`
- `site/README.md`
- `copy.md`
- `section-map.json`
- `deploy-notes.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
