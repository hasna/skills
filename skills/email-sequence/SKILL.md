---
name: email-sequence
description: Generate premium email campaigns with subject lines, preview text, body copy, segmentation notes, CTA variants, and HTML exports.
---

# Email Sequence

Generate a 5 to 10 email campaign package for launch, nurture, onboarding, or reactivation.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills run email-sequence "Usage-based billing for AI SaaS" --audience "founders" --goal "book demos"
skills run email-sequence --campaign "API monitoring launch" --emails 7 --tone technical
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--campaign <text>` | Campaign, product, or offer brief. Positional text also works. | required |
| `--audience <text>` | Target segment. | software teams |
| `--goal <text>` | Conversion goal. | book demos |
| `--emails <n>` | Number of emails, 5-10. | 5 |
| `--tone <tone>` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `sequence.md`
- `emails/email-XX.md`
- `emails/email-XX.html`
- `subject-lines.csv`
- `segmentation-notes.md`
- `cta-variants.csv`
- `send-plan.csv`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
