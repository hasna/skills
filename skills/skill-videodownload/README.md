# service-videodownload

Download videos from YouTube, Vimeo, and other platforms.

## Overview

This service provides a CLI for downloading videos from various platforms using yt-dlp as the backend. It supports multiple formats, quality options, and additional features like subtitle and thumbnail downloads.

## Prerequisites

**yt-dlp** must be installed:

```bash
# macOS
brew install yt-dlp

# Linux/Windows
pip install yt-dlp

# Windows (alternative)
winget install yt-dlp
```

## Installation

```bash
# Install globally
bun install -g @hasnaxyz/service-videodownload

# Or run directly
bunx @hasnaxyz/service-videodownload
```

## Quick Start

```bash
# Download a video
service-videodownload download https://www.youtube.com/watch?v=dQw4w9WgXcQ

# Get video info
service-videodownload info https://www.youtube.com/watch?v=dQw4w9WgXcQ

# List downloads
service-videodownload list
```

## CLI Commands

### download

Download a video from URL.

```bash
service-videodownload download <url> [options]

Options:
  -o, --output <path>     Output file path
  -f, --format <format>   Video format (mp4, webm, best) (default: best)
  -q, --quality <quality> Video quality (best, 720p, 480p) (default: best)
  -a, --audio-only        Download audio only
  -s, --subtitles         Download subtitles
  -t, --thumbnail         Download thumbnail
  --no-metadata           Don't embed metadata
```

### info

Get video information without downloading.

```bash
service-videodownload info <url> [options]

Options:
  --json                  Output as JSON
  --formats               Show available formats
```

### list

List downloaded videos.

```bash
service-videodownload list [options]

Options:
  --json                  Output as JSON
  --history               Show download history
  -n, --limit <number>    Limit results (default: 20)
```

### config

View and edit configuration.

```bash
# View config
service-videodownload config view

# Set a value
service-videodownload config set outputDir ~/Videos

# Get a value
service-videodownload config get outputDir

# Reset to defaults
service-videodownload config reset
```

## Supported Platforms

- YouTube
- Vimeo
- TikTok
- Twitter/X
- Facebook
- Instagram
- Twitch
- And many more (via yt-dlp)

## Output Structure

```
~/.service/service-videodownload/
├── config.json           # Configuration
├── history.json          # Download history
└── downloads/
    ├── youtube/          # Organized by platform
    │   ├── video1.mp4
    │   └── video2.mp4
    ├── vimeo/
    └── tiktok/
```

## Environment Variables

```bash
DATA_DIR=~/.service/service-videodownload  # Custom data directory
DEBUG=1                                      # Enable debug logging
```

## Development

```bash
# Install dependencies
bun install

# Run in development
bun run bin/cli.ts download https://example.com/video

# Type check
bun run typecheck

# Build
bun run build
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **CLI**: Commander.js
- **Backend**: yt-dlp

## License

MIT
