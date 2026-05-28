---
name: meeting-pack
description: Generate premium meeting artifact packs from transcripts or notes with summaries, decisions, action items, owner/deadline tables, follow-up email, project export, timeline, and manifest metadata.
---

# Meeting Pack

Generate a complete meeting artifact package from transcripts, notes, call summaries, or rough bullets.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run meeting-pack --notes "Discussed billing launch, docs, and support owner follow-ups" --meeting "Billing Launch Sync"
skills run meeting-pack ./transcript.txt --participants "Hasna,Alex,Sam" --format executive
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--notes <text>` | Meeting transcript, rough notes, or summary. Positional text also works. | required unless `--source` is used |
| `--source <path>` | Read notes or transcript from a file. | none |
| `--meeting <text>` | Meeting title. | Meeting |
| `--participants <list>` | Comma-separated participant names. | Team |
| `--format <type>` | `project`, `executive`, `sales`, or `standup`. | project |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `meeting-summary.md`
- `decisions.md`
- `action-items.csv`
- `follow-up-email.md`
- `project-export.json`
- `timeline.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
