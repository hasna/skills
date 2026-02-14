---
name: video-generation
description: Generate videos using AI providers like Google Veo 3.1, OpenAI Sora, and Runway. Supports text-to-video generation with professional cinematography controls.
---

# Video Generation Skill

Generate high-quality videos using state-of-the-art AI models from multiple providers.

## Supported Providers

### Google Veo 3.1 (via Vertex AI)
- State-of-the-art video generation
- Up to 4K resolution support
- Advanced cinematography controls (lens types, camera movements)
- Text-to-video generation

### OpenAI Sora
- Text-to-video generation
- High-quality video synthesis
- Note: Requires API access

### Runway (Gen-2/Gen-3)
- Professional video generation
- Fast generation times
- API-first approach

## Usage

### Generate a video
```bash
bun run src/index.ts generate --provider google --prompt "a cat walking on a beach at sunset" --output ./output.mp4
bun run src/index.ts generate --provider runway --prompt "ocean waves crashing" --output ./waves.mp4
bun run src/index.ts generate --provider openai --prompt "city street timelapse" --output ./city.mp4
```

### Check generation status
```bash
bun run src/index.ts status --provider google --job-id abc123
```

### Advanced options
```bash
bun run src/index.ts generate \
  --provider google \
  --prompt "cinematic shot of a forest" \
  --duration 5 \
  --resolution 1080p \
  --output ./forest.mp4
```

## Environment Variables

Set up your API keys:

```bash
# Google Veo 3.1 (Vertex AI)
export GOOGLE_API_KEY=your_key_here
# or
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# OpenAI Sora
export OPENAI_API_KEY=your_key_here

# Runway
export RUNWAY_API_KEY=your_key_here
```

## Installation

```bash
cd skill-video
bun install
```

## Features

- Asynchronous video generation with job tracking
- Automatic status polling
- Download management
- Support for multiple output formats
- Clean TypeScript implementation
- Provider-agnostic interface

## Examples

### Quick generation
```bash
bun run src/index.ts generate --provider google --prompt "a dog playing fetch"
```

### With cinematography controls (Google Veo 3.1)
```bash
bun run src/index.ts generate \
  --provider google \
  --prompt "wide-angle shot of mountains, slow dolly forward" \
  --output ./mountains.mp4
```

### Check status and download
```bash
# Start generation
bun run src/index.ts generate --provider runway --prompt "sunset" --output ./sunset.mp4

# Check status with returned job ID
bun run src/index.ts status --provider runway --job-id job_xyz789
```
