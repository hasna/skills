---
name: landing-page-pack
description: Generate premium landing page copy, wireframes, CTA maps, experiments, and preview artifacts.
---

# Landing Page Pack

Generate a conversion-focused landing page package for a product, service, or offer.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills run landing-page-pack "Usage-based billing for AI SaaS" --audience "founders" --goal "book demos"
skills run landing-page-pack --product "API monitoring" --offer "Find broken API workflows before customers do"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--product <text>` | Product, service, or campaign brief. Positional text also works. | required |
| `--audience <text>` | Primary buyer or user segment. | software teams |
| `--offer <text>` | Core offer or promise. | derived from product |
| `--goal <text>` | Main conversion goal. | book demos |
| `--tone <tone>` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `--proof <text>` | Proof points, metrics, or trust signals. | case studies and testimonials |
| `--sections <list>` | Comma-separated section names. | hero, problem, solution, proof, faq, cta |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `landing-page.md`
- `copy-blocks.json`
- `wireframe.md`
- `preview.html`
- `style-guide.md`
- `cta-map.csv`
- `experiment-plan.md`
- `implementation-notes.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
