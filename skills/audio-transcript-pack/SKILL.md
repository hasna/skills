---
name: audio-transcript-pack
description: Generate premium transcript packages with timestamps, summaries, show notes, clip suggestions, repurposing copy, captions, and manifest metadata.
---

# Audio Transcript Pack

Generate a production-ready transcript package from audio, video, or existing transcript text.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run audio-transcript-pack --source ./episode.mp3 --title "Usage-based billing teardown" --speakers "Host,Guest"
skills run audio-transcript-pack --source ./transcript.txt --format podcast --duration-minutes 42
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--source <path-or-text>` | Audio/video file, transcript text file, or transcript text. | required |
| `--title <text>` | Episode, meeting, or recording title. | Audio Transcript Pack |
| `--speakers <list>` | Comma-separated speaker names. | Speaker 1,Speaker 2 |
| `--format <type>` | `podcast`, `meeting`, `lecture`, `interview`, or `general`. | general |
| `--duration-minutes <n>` | Approximate runtime for timestamp spacing. | 30 |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `transcript.md`
- `captions.srt`
- `summary.md`
- `show-notes.md`
- `clips.csv`
- `content-repurpose-pack.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
