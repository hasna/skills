---
name: social-content-calendar
description: Generate premium social content calendars with daily posts, channel strategy, asset briefs, publishing schedule, and repurposing map.
---

# Social Content Calendar

Generate a 14 to 45 day campaign calendar for launch, nurture, hiring, community, or thought-leadership campaigns.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only skill metadata and instructions.

## Usage

```bash
skills run social-content-calendar "Usage-based billing for AI SaaS" --audience "founders" --days 30
skills run social-content-calendar --campaign "API monitoring launch" --channels "LinkedIn,X,Newsletter" --tone technical
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--campaign <text>` | Campaign, product, or content brief. Positional text also works. | required |
| `--audience <text>` | Target segment. | software teams |
| `--goal <text>` | Campaign goal. | build qualified demand |
| `--days <n>` | Calendar length, 14-45 days. | 30 |
| `--channels <list>` | Comma-separated channels. | LinkedIn, X, Newsletter |
| `--tone <tone>` | `direct`, `premium`, `friendly`, or `technical`. | direct |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `calendar.md`
- `posts.csv`
- `channel-plan.json`
- `asset-briefs.md`
- `hooks.md`
- `publishing-schedule.csv`
- `repurposing-map.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
