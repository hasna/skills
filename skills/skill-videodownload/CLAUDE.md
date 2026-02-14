# service-videodownload

Download videos from YouTube, Vimeo, and other platforms using yt-dlp.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **CLI**: Commander.js
- **Backend**: yt-dlp

## Project Structure

```
service-videodownload/
├── bin/
│   └── cli.ts              # CLI entry point
├── src/
│   ├── commands/           # CLI commands
│   │   ├── download.ts     # Download video
│   │   ├── info.ts         # Get video info
│   │   ├── list.ts         # List downloads
│   │   └── config.ts       # Configuration
│   ├── lib/                # Core modules
│   │   ├── downloader.ts   # yt-dlp wrapper
│   │   └── storage.ts      # Local storage
│   ├── types/
│   │   └── index.ts        # TypeScript types
│   └── utils/
│       ├── logger.ts       # Colored logging
│       └── paths.ts        # Path utilities
├── legacy/                 # Python implementation (archived)
├── package.json
├── tsconfig.json
└── README.md
```

## CLI Commands

```bash
# Download video
service-videodownload download https://youtube.com/watch?v=xxx

# Get video info
service-videodownload info https://youtube.com/watch?v=xxx --formats

# List downloads
service-videodownload list

# Configure
service-videodownload config view
```

## Prerequisites

Requires yt-dlp: `brew install yt-dlp`

## Development

```bash
bun install
bun run bin/cli.ts download https://example.com/video
bun run typecheck
```
