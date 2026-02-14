# Audio Generation Skill

A comprehensive Claude Code skill for generating high-quality audio using AI-powered text-to-speech APIs.

## Features

- Multiple TTS providers: ElevenLabs, OpenAI TTS, and Google Text-to-Speech
- Simple, elegant CLI interface
- Voice selection and listing
- Multiple languages support
- Customizable speech speed
- Clean TypeScript implementation with full type safety
- Native fetch API (no external HTTP libraries needed)

## Supported Providers

### ElevenLabs
- Natural voice synthesis with voice cloning capabilities
- Models: `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_v3`
- Multiple languages and voice options
- Professional-quality audio output

### OpenAI TTS
- High-quality text-to-speech
- Models: `tts-1` (fast), `tts-1-hd` (high quality)
- Voices: alloy, echo, fable, onyx, nova, shimmer
- Speed control (0.25x to 4.0x)

### Google Text-to-Speech
- Cloud-based TTS service
- Wide range of voices and languages
- Natural-sounding speech synthesis
- Configurable pitch and speaking rate

## Installation

1. Install Bun (if not already installed):
```bash
curl -fsSL https://bun.sh/install | bash
```

2. Clone and navigate to the skill directory:
```bash
git clone https://github.com/hasnaxyz/skill-audio.git
cd skill-audio
```

3. Install dependencies:
```bash
bun install
```

4. Set up environment variables:
```bash
cp .env.example .env
# Edit .env and add your API keys
```

## Configuration

Create a `.env` file with your API keys:

```bash
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_API_KEY=your_google_api_key_here
```

### Getting API Keys

- **ElevenLabs**: https://elevenlabs.io/
- **OpenAI**: https://platform.openai.com/api-keys
- **Google Cloud**: https://console.cloud.google.com/apis/credentials

## Usage

### Generate Audio

#### ElevenLabs
```bash
bun run src/index.ts generate \
  --provider elevenlabs \
  --text "Hello world, this is a test of ElevenLabs text to speech" \
  --voice rachel \
  --model eleven_multilingual_v2 \
  --output ./output.mp3
```

#### OpenAI TTS
```bash
bun run src/index.ts generate \
  --provider openai \
  --text "Hello world, this is a test of OpenAI text to speech" \
  --voice nova \
  --model tts-1-hd \
  --speed 1.0 \
  --output ./output.mp3
```

#### Google Text-to-Speech
```bash
bun run src/index.ts generate \
  --provider google \
  --text "Hello world, this is a test of Google text to speech" \
  --language en-US \
  --speed 1.0 \
  --output ./output.mp3
```

### List Available Voices

```bash
# ElevenLabs voices
bun run src/index.ts voices --provider elevenlabs

# OpenAI voices
bun run src/index.ts voices --provider openai

# Google voices
bun run src/index.ts voices --provider google
```

### Show Help

```bash
bun run src/index.ts help
```

## CLI Options

### Generate Command

| Option | Description | Required | Default |
|--------|-------------|----------|---------|
| `--provider` | Provider to use (elevenlabs, openai, google) | Yes | - |
| `--text` | Text to convert to speech | Yes | - |
| `--output` | Output file path (e.g., ./output.mp3) | Yes | - |
| `--voice` | Voice to use (provider-specific) | No | Provider default |
| `--model` | Model to use (provider-specific) | No | Provider default |
| `--language` | Language code (Google TTS, e.g., en-US) | No | en-US |
| `--speed` | Speaking speed (0.25-4.0) | No | 1.0 |

### Voices Command

| Option | Description | Required |
|--------|-------------|----------|
| `--provider` | Provider to list voices from | Yes |

## Examples

### Quick Test with Different Providers

```bash
# ElevenLabs - Natural voice
bun run src/index.ts generate \
  --provider elevenlabs \
  --text "The quick brown fox jumps over the lazy dog" \
  --voice rachel \
  --output ./elevenlabs_test.mp3

# OpenAI - High quality
bun run src/index.ts generate \
  --provider openai \
  --text "The quick brown fox jumps over the lazy dog" \
  --voice nova \
  --model tts-1-hd \
  --output ./openai_test.mp3

# Google - Multilingual
bun run src/index.ts generate \
  --provider google \
  --text "The quick brown fox jumps over the lazy dog" \
  --language en-US \
  --output ./google_test.mp3
```

### Generate with Custom Speed

```bash
# Slower speech
bun run src/index.ts generate \
  --provider openai \
  --text "This is spoken slowly" \
  --voice onyx \
  --speed 0.75 \
  --output ./slow.mp3

# Faster speech
bun run src/index.ts generate \
  --provider openai \
  --text "This is spoken quickly" \
  --voice nova \
  --speed 1.5 \
  --output ./fast.mp3
```

## Project Structure

```
skill-audio/
├── SKILL.md              # Skill metadata and description
├── README.md             # This file
├── package.json          # Bun project configuration
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Example environment variables
├── src/
│   ├── index.ts          # CLI entry point
│   ├── types.ts          # TypeScript type definitions
│   └── providers/
│       ├── elevenlabs.ts # ElevenLabs provider
│       ├── openai.ts     # OpenAI TTS provider
│       └── google.ts     # Google TTS provider
```

## Development

### Run in Development Mode

```bash
bun run dev
```

### Type Checking

```bash
bun run tsc --noEmit
```

## Error Handling

The CLI provides clear error messages for common issues:

- Missing API keys
- Invalid providers
- Voice not found
- API errors
- File write errors

## Troubleshooting

### "API key not found" error
Make sure you've created a `.env` file with the appropriate API key for the provider you're using.

### "Voice not found" error
Use the `voices` command to list available voices for your chosen provider.

### API errors
Check that your API keys are valid and have sufficient credits/quota.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
