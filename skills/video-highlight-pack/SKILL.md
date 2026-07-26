---
name: video-highlight-pack
description: Generate video highlight packages with clip plans, captions, thumbnails, chapter markers, social copy, edit decisions, and manifest metadata.
kind: instruction
---

# Video Highlight Pack

Generate a practical highlight package from a long video, recording, webinar, demo, interview, lecture, or existing transcript.

## Requirements

None. This is an instruction skill: it is prose an agent follows, so it needs no
credentials, no network access, and no local runtime.

## Usage

Ask an agent for the deliverables below and give it the inputs. Reading this file
IS the invocation; `skills run` refuses instruction skills on purpose.

## Inputs

| Input | Description | Default |
|--------|-------------|---------|
| `source` | Video file, transcript text file, or transcript text. | required |
| `title` | Recording title. | Video Highlight Pack |
| `platforms` | Comma-separated platforms for export planning. | youtube-shorts,instagram,tiktok,linkedin |
| `duration-minutes` | Approximate source runtime for timestamp spacing. | 45 |
| `aspect-ratio` | Primary edit aspect ratio. | 9:16 |

## Deliverables

- `highlight-plan.md`
- `clips.csv`
- `chapters.json`
- `captions.srt`
- `thumbnail-briefs.md`
- `social-posts.md`
- `edit-decision-list.json`
- `manifest.json`

## Method

1. Work from a transcript. If given a media file, transcribe it first (the
   `audio-transcript-pack` skill, or a local `ffmpeg` + transcription step); this
   skill plans from text.
2. Select highlights by self-contained value: a clip that needs context to make
   sense is not a highlight.
3. Give each clip precise in/out timecodes and a reason for selection.
4. Write captions to the platform's line-length limits and keep them readable at
   speed.
5. Set chapter markers at genuine topic boundaries, not at fixed intervals.
6. Write per-platform social copy that stands alone without the video.
7. Deliver the edit decision list so an editor can cut without re-watching.
