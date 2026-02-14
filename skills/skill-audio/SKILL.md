---
name: Audio Generation
description: Generate high-quality audio using ElevenLabs, OpenAI TTS, and Google Text-to-Speech APIs. Support for text-to-speech, voice cloning, multiple languages, and various voice options.
---

# Audio Generation Skill

This skill provides a unified interface for generating audio from text using multiple AI-powered text-to-speech providers.

## Supported Providers

### ElevenLabs
- Text-to-speech with natural voice synthesis
- Voice cloning capabilities
- Multiple languages support
- Models: eleven_multilingual_v2, eleven_flash_v2_5, eleven_v3

### OpenAI TTS
- High-quality text-to-speech
- Models: tts-1 (fast), tts-1-hd (high quality)
- Voices: alloy, echo, fable, onyx, nova, shimmer

### Google Text-to-Speech
- Cloud-based TTS service
- Wide range of voices and languages
- Natural-sounding speech synthesis

## Usage

### Generate Audio
```bash
bun run src/index.ts generate --provider elevenlabs --text "Hello world" --voice rachel --output ./output.mp3
bun run src/index.ts generate --provider openai --text "Hello world" --voice nova --output ./output.mp3
bun run src/index.ts generate --provider google --text "Hello world" --output ./output.mp3
```

### List Available Voices
```bash
bun run src/index.ts voices --provider elevenlabs
bun run src/index.ts voices --provider openai
bun run src/index.ts voices --provider google
```

## Configuration

Set up API keys as environment variables:
```bash
export ELEVENLABS_API_KEY=your_elevenlabs_key
export OPENAI_API_KEY=your_openai_key
export GOOGLE_API_KEY=your_google_key
```

## Features

- Simple, elegant CLI interface
- Support for multiple TTS providers
- Voice listing and selection
- Customizable output formats
- Clean TypeScript implementation
- Native fetch API (no external HTTP libraries)
