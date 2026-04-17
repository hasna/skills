---
name: Extract Audio
version: 0.1.0
description: Extract audio tracks from video files using FFmpeg with format conversion options
author: skills.md
category: Design & Creative
tags:
  - audio
  - video
  - ffmpeg
  - conversion
  - extraction
  - podcasting
credits: 1
---

# Extract Audio

Rip audio from any video. Extract high-quality audio tracks from MP4, MOV, or MKV files. Convert to MP3, WAV, or FLAC for podcasts, transcription, or music libraries. This skill handles the FFmpeg complexity so you don't have to.

## Features

- **Format Flexibility**: Converts to MP3 (universal), WAV (lossless), AAC (efficient), or FLAC (audiophile).
- **Quality Control**: Choose from "Low" (voice memos) to "Ultra" (music production).
- **Batch Processing**: Extracts audio from an entire folder of videos at once.
- **Metadata Preservation**: Keeps original filenames and timestamps organized.
- **Fast Extraction**: Uses stream copying where possible for instant results.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Usage

```bash
# Extract MP3 from a video
skills run extract-audio -- video.mp4

# Extract high-quality WAV
skills run extract-audio -- concert.mov --format wav --quality high

# Batch extract a folder
skills run extract-audio -- ./videos/*.mp4 --format mp3
```

## Options

| Option      | Description                              | Default                        |
| ----------- | ---------------------------------------- | ------------------------------ |
| `<files...>`| Input video files (positional args)      | -                              |
| `--format`  | Output format (`mp3`, `wav`, `aac`)      | mp3                            |
| `--quality` | Bitrate level (`low`, `medium`, `high`)  | medium                         |
| `--output`  | Custom output path (single file only)    | .skills/exports/extract-audio/ |

## Output

- **Audio File**: The extracted track saved to the export directory.
- **Log**: A record of the conversion process.

## Examples

### Podcast Workflow
```bash
skills run extract-audio -- interview_zoom.mp4 --format wav --quality high
```

### Lecture Notes
```bash
skills run extract-audio -- lecture_recording.mkv --format mp3 --quality low
```

## Requirements

- FFmpeg installed and in PATH.
- Bun runtime.