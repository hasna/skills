---
name: emoji
description: Generate emoji packs using AI-powered prompt generation and image creation
---

# Emoji Pack Generator Skill

Generate complete emoji packs from a single theme using AI.

## Supported Providers

### OpenAI
- **Prompt Model**: gpt-4o-mini
- **Image Model**: dall-e-3
- **API Key**: `OPENAI_API_KEY`

### Google Gemini
- **Prompt Model**: gemini-1.5-flash
- **Image Model**: imagen-3.0-generate-001
- **API Keys**: `GEMINI_API_KEY`, `GOOGLE_PROJECT_ID`

## Usage

```bash
# Basic usage
bun run src/index.ts generate --theme "Christmas" --count 10

# With options
bun run src/index.ts generate \
  --theme "Food" \
  --count 15 \
  --provider openai \
  --style 3d \
  --size 256 \
  --format zip \
  --output ./food-emojis.zip
```

## Options

- `--theme, -t`: Theme for emoji pack (required)
- `--count, -c`: Number of emojis (1-50, default: 5)
- `--provider, -p`: openai or gemini (default: openai)
- `--style`: flat, 3d, outline, gradient (default: flat)
- `--size, -s`: Output size in pixels (default: 128)
- `--format, -f`: directory or zip (default: directory)
- `--output, -o`: Output path
- `--concurrency`: Parallel generations (default: 3)

## Environment Variables

```bash
export OPENAI_API_KEY="your-openai-key"
export GEMINI_API_KEY="your-gemini-key"
export GOOGLE_PROJECT_ID="your-project-id"
```

## Workflow

1. AI generates creative prompts based on theme
2. Images generated concurrently via selected provider
3. Images resized to target size
4. Output saved with manifest.json
