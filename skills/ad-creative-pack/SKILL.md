---
name: ad-creative-pack
description: Generate premium paid-ad copy, creative concepts, image prompts, audience angles, and test matrices.
---

# Ad Creative Pack

Generate a paid-ad launch package for Meta, Google, and LinkedIn.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills run ad-creative-pack "Usage-based billing for AI SaaS" --audience "founders" --goal "book demos"
skills run ad-creative-pack --product "API monitoring" --offer "Find broken API workflows before customers do"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--product <text>` | Product, service, or campaign brief. Positional text also works. | required |
| `--audience <text>` | Target buyer or segment. | software teams |
| `--offer <text>` | Campaign promise or offer. | derived from product |
| `--goal <text>` | Conversion goal. | book demos |
| `--platforms <list>` | Comma-separated platforms. | Meta, Google, LinkedIn |
| `--tone <tone>` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `platform-copy.md`
- `ad-copy.json`
- `creative-concepts.md`
- `image-prompts.md`
- `audience-angles.csv`
- `test-matrix.csv`
- `launch-checklist.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
