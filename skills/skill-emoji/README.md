# Emoji Pack Generator Skill

Generate complete emoji packs using AI. Provide a theme, and the AI will create prompts for each emoji and generate them using OpenAI DALL-E 3 or Google Gemini.

## Features

- AI-powered prompt generation for cohesive emoji sets
- Multiple providers: OpenAI DALL-E 3, Google Gemini
- Concurrent image generation for speed
- Automatic resizing to any target size
- Multiple output formats: directory or zip
- Customizable styles: flat, 3d, outline, gradient
- Manifest file with metadata and prompts

## Installation

```bash
cd skill-emoji
bun install
```

## Configuration

Set up your API keys as environment variables:

```bash
# OpenAI (for both prompt generation and image generation)
export OPENAI_API_KEY="your-openai-api-key"

# Google Gemini (for both prompt generation and image generation)
export GEMINI_API_KEY="your-gemini-api-key"
export GOOGLE_PROJECT_ID="your-google-project-id"  # Required for Gemini images
```

## Usage

### Basic Commands

```bash
# Generate 5 Christmas emojis (default)
bun run src/index.ts generate --theme "Christmas"

# Generate 10 food emojis
bun run src/index.ts generate --theme "Food and Drinks" --count 10

# Generate animal emojis with Gemini
bun run src/index.ts generate --theme "Cute Animals" --count 8 --provider gemini
```

### Advanced Options

```bash
# Generate as zip file
bun run src/index.ts generate \
  --theme "Weather" \
  --count 6 \
  --format zip \
  --output ./weather-emojis.zip

# Generate 3D style, larger size
bun run src/index.ts generate \
  --theme "Sports" \
  --count 12 \
  --style 3d \
  --size 256

# Custom output directory with high concurrency
bun run src/index.ts generate \
  --theme "Office" \
  --count 15 \
  --output ./my-emojis \
  --concurrency 5
```

### Short Flags

```bash
bun run src/index.ts generate \
  -t "Halloween" \
  -c 10 \
  -p openai \
  -s 128 \
  -f directory \
  -o ./halloween-emojis
```

## Options Reference

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--theme` | `-t` | required | Theme for the emoji pack |
| `--count` | `-c` | 5 | Number of emojis (1-50) |
| `--provider` | `-p` | openai | Image provider (openai, gemini) |
| `--size` | `-s` | 128 | Output size in pixels |
| `--style` | | flat | Style (flat, 3d, outline, gradient) |
| `--output` | `-o` | auto | Output path |
| `--format` | `-f` | directory | Output format (directory, zip) |
| `--concurrency` | | 3 | Concurrent image generations |

## Workflow

1. **Prompt Generation**: AI analyzes the theme and generates creative prompts for each emoji
2. **Image Generation**: Prompts are dispatched concurrently to the image provider
3. **Resizing**: Generated images are resized to the target size
4. **Output**: Files are saved to directory or packaged as zip

## Output Structure

### Directory Format

```
emoji-christmas/
├── manifest.json
├── santa-hat.png
├── gift-box.png
├── snowflake.png
├── christmas-tree.png
└── candy-cane.png
```

### Manifest File

```json
{
  "theme": "Christmas",
  "count": 5,
  "size": 128,
  "generated": "2024-12-11T12:00:00.000Z",
  "emojis": [
    {
      "name": "santa-hat",
      "filename": "santa-hat.png",
      "prompt": "A red Santa Claus hat with white fluffy trim..."
    }
  ]
}
```

## Styles

- **flat**: Solid colors, no shadows, minimal detail
- **3d**: Soft 3D style, subtle shadows, rounded shapes
- **outline**: Line art style, clean outlines
- **gradient**: Gradient colors, smooth transitions

## Provider Details

### OpenAI DALL-E 3

- High-quality, detailed images
- Great for creative and stylized emojis
- Faster prompt revision and enhancement

### Google Gemini (Imagen 3)

- Photorealistic capabilities
- Good for realistic emoji styles
- Requires Google Cloud Project ID

## Tips

1. **Theme specificity**: More specific themes produce more cohesive packs
2. **Count**: Start with 5-10 to test, then scale up
3. **Concurrency**: Higher values = faster, but may hit rate limits
4. **Size**: 128px is standard for emojis, 256px for icons

## Error Handling

- Failed generations are logged but don't stop the process
- Partial results are still saved
- Manifest includes only successfully generated emojis

## License

MIT
