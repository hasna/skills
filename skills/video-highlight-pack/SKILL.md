---
name: video-highlight-pack
description: Generate premium video highlight packages with clip plans, captions, thumbnails, chapter markers, social copy, edit decisions, and manifest metadata.
---

# Video Highlight Pack

Generate a practical highlight package from a long video, recording, webinar, demo, interview, lecture, or existing transcript.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run video-highlight-pack --source ./webinar.mp4 --title "AI billing launch webinar" --platforms "youtube-shorts,linkedin"
skills run video-highlight-pack --source ./transcript.txt --duration-minutes 58 --aspect-ratio 9:16
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--source <path-or-text>` | Video file, transcript text file, or transcript text. | required |
| `--title <text>` | Recording title. | Video Highlight Pack |
| `--platforms <list>` | Comma-separated platforms for export planning. | youtube-shorts,instagram,tiktok,linkedin |
| `--duration-minutes <n>` | Approximate source runtime for timestamp spacing. | 45 |
| `--aspect-ratio <ratio>` | Primary edit aspect ratio. | 9:16 |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `highlight-plan.md`
- `clips.csv`
- `chapters.json`
- `captions.srt`
- `thumbnail-briefs.md`
- `social-posts.md`
- `edit-decision-list.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
