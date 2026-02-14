# Video Generation Skill for Claude Code

A comprehensive Claude Code skill for generating videos using state-of-the-art AI models from Google Veo 2, OpenAI Sora, and Runway.

## Features

- **Multiple Providers**: Support for Google Veo 2, OpenAI Sora, and Runway
- **Async Generation**: Proper job tracking and status polling
- **Flexible Options**: Control duration, resolution, and aspect ratio
- **Clean CLI**: Simple, elegant command-line interface
- **TypeScript**: Fully typed with clean architecture
- **Native Fetch**: Uses Bun's native fetch API

## Installation

```bash
cd skill-video
bun install
```

## Configuration

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Then edit `.env` with your credentials:

```bash
# For Google Veo 2
GOOGLE_API_KEY=your_key
# or
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_CLOUD_PROJECT=your-project-id

# For OpenAI Sora
OPENAI_API_KEY=your_key

# For Runway
RUNWAY_API_KEY=your_key
```

## Usage

### Generate a Video

```bash
# Using Google Veo 2
bun run src/index.ts generate \
  --provider google \
  --prompt "a cat walking on a beach at sunset" \
  --output ./cat.mp4

# Using Runway
bun run src/index.ts generate \
  --provider runway \
  --prompt "ocean waves crashing on rocks" \
  --duration 10 \
  --output ./waves.mp4

# Using OpenAI Sora
bun run src/index.ts generate \
  --provider openai \
  --prompt "city street timelapse at night" \
  --resolution 1080p \
  --output ./city.mp4
```

### Check Status

```bash
bun run src/index.ts status \
  --provider runway \
  --job-id abc123xyz
```

### Advanced Options

```bash
bun run src/index.ts generate \
  --provider google \
  --prompt "cinematic wide-angle shot of mountains, slow dolly forward" \
  --duration 5 \
  --resolution 4k \
  --aspect-ratio 16:9 \
  --output ./mountains.mp4
```

## Supported Providers

### Google Veo 2
- State-of-the-art video generation via Vertex AI
- Up to 4K resolution
- Advanced cinematography controls (lens types, camera movements)
- Understands professional video terminology

### OpenAI Sora
- High-quality text-to-video generation
- Note: API access may be limited/waitlisted

### Runway
- Gen-2/Gen-3 video generation
- Fast generation times
- Professional video quality
- Production-ready API

## Project Structure

```
skill-video/
├── SKILL.md              # Claude Code skill definition
├── package.json          # Bun project configuration
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variables template
├── README.md            # This file
└── src/
    ├── index.ts         # Main entry point & CLI
    ├── cli.ts           # CLI argument parsing
    ├── types.ts         # TypeScript type definitions
    └── providers/
        ├── index.ts           # Provider factory
        ├── google-veo.ts      # Google Veo 2 implementation
        ├── openai-sora.ts     # OpenAI Sora implementation
        └── runway.ts          # Runway implementation
```

## Architecture

Each provider implements the `VideoProvider` interface:

```typescript
interface VideoProvider {
  name: string;
  generate(options: GenerateOptions): Promise<VideoJob>;
  getStatus(jobId: string): Promise<VideoJob>;
  download(videoUrl: string, outputPath: string): Promise<void>;
}
```

This ensures consistent behavior across all providers while allowing provider-specific implementations.

## Development

### Run in development mode
```bash
bun run dev
```

### Add a new provider

1. Create a new file in `src/providers/your-provider.ts`
2. Implement the `VideoProvider` interface
3. Add it to `src/providers/index.ts`
4. Update the CLI to support the new provider

## Limitations & Notes

- **Google Veo 2**: API is in preview. Implementation based on expected patterns.
- **OpenAI Sora**: Public API availability is limited. Check with OpenAI for access.
- **Runway**: Production-ready with documented API.

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- Code follows TypeScript best practices
- New providers implement the `VideoProvider` interface
- CLI remains simple and elegant
- Documentation is updated
