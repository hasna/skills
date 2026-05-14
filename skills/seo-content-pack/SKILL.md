---
name: seo-content-pack
description: Generate premium SEO content packages with topic clusters, articles, metadata, links, FAQs, and publishing cadence.
---

# SEO Content Pack

Generate a complete SEO content package from a topic, audience, and product context.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run seo-content-pack --topic "usage-based billing for AI SaaS" --audience "founders and operators"
skills run seo-content-pack "developer onboarding automation" --brand "Acme" --articles 5
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--topic <text>` | Core topic or search theme. Positional text also works. | required |
| `--brand <name>` | Brand or product name. | Brand |
| `--audience <text>` | Target audience. | SaaS buyers |
| `--articles <n>` | Supporting article count, 3-8. | 5 |
| `--tone <tone>` | `practical`, `executive`, or `technical`. | practical |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `topic-cluster.md`
- `pillar-article.md`
- `supporting-articles/article-*.md`
- `metadata.csv`
- `internal-linking-plan.md`
- `faqs.md`
- `publishing-cadence.csv`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
