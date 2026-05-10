---
name: Compress Video
version: 0.1.0
description: Compress videos while preserving quality using FFmpeg with multiple codec options and preset configurations
author: skills.md
category: Design & Creative
tags:
  - video
  - ffmpeg
  - compression
  - media
  - batch
  - optimization
---

# Compress Video

Shrink video files without sacrificing quality. This skill uses FFmpeg to intelligently compress videos for Web, Mobile, or Archive storage. It includes smart presets (1080p, 720p), batch processing for folders, and target file size calculations.

## Features

- **Smart Presets**: "Web" (Balanced), "Mobile" (Small), "Archive" (High Compression), "High Quality" (Near Lossless).
- **Target Size**: Automatically calculates the bitrate needed to hit a specific file size (e.g., "50MB").
- **Batch Processing**: Compresses entire folders of videos in one go.
- **Codec Choice**: Supports H.264 (Compatibility), H.265/HEVC (Efficiency), and VP9 (Web).
- **Resolution Scaling**: Easily downscale 4K to 1080p or 720p.

> **This is a CLI skill.** It requires the `skills` CLI to execute. Install it with `npm install -g @hasna/skills`, then run the commands below.

## Usage

```bash
# Compress for web sharing
skills run compress-video -- input.mp4 --preset web

# Compress to a specific size
skills run compress-video -- large_file.mov --target-size 50

# Batch compress a folder
skills run compress-video -- ./raw_footage/*.mp4 --preset mobile --output ./proxies/
```

## Options

| Option          | Description                                      | Default        |
| --------------- | ------------------------------------------------ | -------------- |
| `<files...>`    | Input video files (positional args)              | -              |
| `--preset`      | Compression profile (`web`, `mobile`, `archive`) | web            |
| `--target-size` | Desired file size in MB                          | -              |
| `--resolution`  | Output resolution (`1080p`, `720p`, `original`)  | original       |
| `--codec`       | Video codec (`h264`, `hevc`, `vp9`)              | h264           |
| `--crf`         | Custom quality factor (0-51)                     | (varies)       |
| `--output`      | Output directory                                 | (same as input)|

## Output

- **Compressed Files**: Saved to the output directory with a suffix (e.g., `_compressed.mp4`).
- **Stats**: A summary of space saved and compression ratio.

## Examples

### Archive Footage
```bash
skills run compress-video -- project_archive/*.mov \
  --preset archive \
  --codec hevc
```

### Social Media Prep
```bash
skills run compress-video -- vlog.mp4 \
  --resolution 1080p \
  --target-size 100
```

## Requirements

- FFmpeg installed and in PATH.
- Bun runtime.