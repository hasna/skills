---
name: product-mockup
description: Generate premium product mockup packages with SVG visual variants, image direction prompts, scene planning, usage notes, asset metadata, and manifest.
---

# Product Mockup

Generate a polished product mockup package for a SaaS product, app feature, launch campaign, or sales deck.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run product-mockup "Usage-based billing dashboard" --audience "founders" --variants 3
skills run product-mockup --product "AI meeting assistant" --scene "homepage hero" --style "quiet premium"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--product <text>` | Product, feature, or campaign description. Positional text also works. | required |
| `--audience <text>` | Target audience. | software buyers |
| `--scene <text>` | Desired context or surface. | SaaS marketing and product screens |
| `--style <text>` | Visual direction. | polished SaaS, crisp product UI, restrained color |
| `--variants <n>` | Number of mockup variants, 1-4. | 3 |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `mockup-brief.md`
- `image-prompts.md`
- `scene-plan.json`
- `variants/variant-01.svg`
- `variants/variant-02.svg`
- `variants/variant-03.svg`
- `usage-notes.md`
- `asset-metadata.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
