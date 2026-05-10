# Quick Start Guide

Get started with audio generation in under 5 minutes!

## 1. Set Up API Keys

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` and add at least one API key:
```bash
# Choose one or more providers:
OPENAI_API_KEY=sk-...              # Easiest to get started
ELEVENLABS_API_KEY=...             # Best voice quality
GOOGLE_API_KEY=...                 # Most language options
```

## 2. Test the Installation

List available voices (no API key needed for OpenAI):
```bash
bun run src/index.ts voices --provider openai
```

## 3. Generate Your First Audio

### Option A: OpenAI TTS (Recommended for beginners)
```bash
bun run src/index.ts generate \
  --provider openai \
  --text "Hello, this is my first audio generation!" \
  --voice nova \
  --output ./test.mp3
```

### Option B: ElevenLabs (Best quality)
```bash
bun run src/index.ts generate \
  --provider elevenlabs \
  --text "Hello, this is my first audio generation!" \
  --voice rachel \
  --output ./test.mp3
```

### Option C: Google TTS (Most languages)
```bash
bun run src/index.ts generate \
  --provider google \
  --text "Hello, this is my first audio generation!" \
  --language en-US \
  --output ./test.mp3
```

## 4. Play Your Audio

On macOS:
```bash
afplay test.mp3
```

On Linux:
```bash
mpg123 test.mp3
# or
ffplay test.mp3
```

On Windows:
```bash
start test.mp3
```

## Next Steps

- Explore different voices: `bun run src/index.ts voices --provider <name>`
- Try different speeds: Add `--speed 1.5` for faster speech
- Use different models: Add `--model tts-1-hd` for higher quality (OpenAI)
- See all options: `bun run src/index.ts help`

## Common Use Cases

### Podcast Intro
```bash
bun run src/index.ts generate \
  --provider elevenlabs \
  --text "Welcome to the Tech Talk podcast, where we discuss the latest in technology and innovation" \
  --voice adam \
  --output ./podcast_intro.mp3
```

### Multilingual Content (Google)
```bash
bun run src/index.ts generate \
  --provider google \
  --text "Bonjour, comment allez-vous?" \
  --language fr-FR \
  --output ./french_greeting.mp3
```

### Audiobook Narration
```bash
bun run src/index.ts generate \
  --provider openai \
  --text "Chapter 1: The Beginning. It was a dark and stormy night..." \
  --voice fable \
  --model tts-1-hd \
  --speed 0.9 \
  --output ./chapter1.mp3
```

## Troubleshooting

**Error: API key not found**
- Make sure you've created a `.env` file
- Check that your API key is correctly formatted
- Verify the environment variable name matches the provider

**Error: Voice not found**
- List available voices first: `bun run src/index.ts voices --provider <name>`
- Use the exact voice ID from the list

**Poor audio quality**
- Use `--model tts-1-hd` with OpenAI for higher quality
- Try `eleven_multilingual_v2` model with ElevenLabs
- Adjust `--speed` for more natural speech

## Getting API Keys

### OpenAI (Easiest, $0.015/1K chars)
1. Visit https://platform.openai.com/api-keys
2. Sign up or log in
3. Click "Create new secret key"
4. Copy and paste into `.env`

### ElevenLabs (Best quality, free tier available)
1. Visit https://elevenlabs.io/
2. Sign up for a free account (10K chars/month)
3. Go to Profile > API Keys
4. Copy and paste into `.env`

### Google Cloud (Most languages, complex setup)
1. Visit https://console.cloud.google.com/
2. Create a project
3. Enable Text-to-Speech API
4. Create credentials (API key)
5. Copy and paste into `.env`

## Tips for Best Results

1. **Keep sentences natural**: Punctuation affects pacing and intonation
2. **Use appropriate voices**: Match voice to content (professional, casual, storytelling)
3. **Adjust speed**: 0.9-1.0 for audiobooks, 1.0-1.2 for casual content
4. **Test different providers**: Each has unique strengths
5. **Mind your costs**: Monitor usage, especially with paid tiers

Enjoy generating audio!
