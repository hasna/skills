# Image Generation Skill

A Claude Code skill for generating images using multiple AI providers: OpenAI DALL-E 3, Google Imagen 3, and xAI Aurora.

## Features

- Multiple AI providers in one unified interface
- Clean, type-safe TypeScript implementation
- Simple CLI interface
- Native Bun runtime (no external dependencies)
- Support for custom models and sizes
- Automatic image download and saving

## Installation

```bash
cd skill-image
bun install
```

## Configuration

Set up your API keys as environment variables:

```bash
# OpenAI
export OPENAI_API_KEY="your-openai-api-key"

# Google Gemini
export GEMINI_API_KEY="your-gemini-api-key"
export GOOGLE_PROJECT_ID="your-google-project-id"

# xAI
export XAI_API_KEY="your-xai-api-key"
```

## Usage

### Basic Commands

```bash
# OpenAI DALL-E 3
bun run src/index.ts generate --provider openai --prompt "a cat" --output ./cat.png

# Google Imagen 3
bun run src/index.ts generate --provider google --prompt "a dog" --output ./dog.png

# xAI Aurora
bun run src/index.ts generate --provider xai --prompt "a bird" --output ./bird.png
```

### Advanced Options

```bash
# Custom size with OpenAI
bun run src/index.ts generate \
  --provider openai \
  --prompt "a futuristic cityscape" \
  --output ./city.png \
  --size 1792x1024

# Custom model
bun run src/index.ts generate \
  --provider openai \
  --prompt "abstract art" \
  --output ./art.png \
  --model dall-e-3

# Google Imagen with aspect ratio
bun run src/index.ts generate \
  --provider google \
  --prompt "mountain landscape" \
  --output ./mountain.png \
  --size 16:9
```

### Short Flags

```bash
bun run src/index.ts generate \
  -p openai \
  --prompt "a sunset" \
  -o ./sunset.png \
  -s 1024x1024
```

## Provider Details

### OpenAI DALL-E 3

- **Endpoint**: `https://api.openai.com/v1/images/generations`
- **Models**:
  - `dall-e-3` (default) - Latest DALL-E model
  - `gpt-image-1` - GPT-4o image generation
- **Sizes**:
  - `1024x1024` (default, square)
  - `1792x1024` (landscape)
  - `1024x1792` (portrait)
- **Features**: High-quality, detailed images with prompt revision

### Google Imagen 3

- **Endpoint**: Vertex AI REST API
- **Model**: `imagen-3.0-generate-001`
- **Aspect Ratios**:
  - `1:1` (default, square)
  - `3:4` (portrait)
  - `4:3` (landscape)
  - `9:16` (vertical)
  - `16:9` (wide)
- **Features**: Photorealistic images with excellent quality

### xAI Grok-2 Image

- **Endpoint**: `https://api.x.ai/v1/images/generations`
- **Model**: `grok-2-image-1212` (Grok's image generator)
- **Features**: Text-to-image with creative interpretation
- **Price**: $0.07 per image

## Project Structure

```
skill-image/
├── SKILL.md              # Skill metadata with YAML frontmatter
├── README.md             # This file
├── package.json          # Bun package configuration
├── tsconfig.json         # TypeScript configuration
└── src/
    ├── index.ts          # Main CLI entry point
    ├── types.ts          # TypeScript type definitions
    └── providers/
        ├── openai.ts     # OpenAI DALL-E provider
        ├── google.ts     # Google Imagen provider
        └── xai.ts        # xAI Aurora provider
```

## Development

The code is written in TypeScript and uses native Bun APIs:

- `fetch` for HTTP requests (built into Bun)
- File system operations via `fs/promises`
- No external dependencies for image generation

## Error Handling

The skill includes comprehensive error handling:

- API key validation
- HTTP error responses
- Invalid parameter detection
- File system errors
- Network failures

## Examples

### Generate a photorealistic image

```bash
bun run src/index.ts generate \
  --provider google \
  --prompt "a photorealistic portrait of a woman with red hair, studio lighting, professional photography" \
  --output ./portrait.png
```

### Generate concept art

```bash
bun run src/index.ts generate \
  --provider openai \
  --prompt "concept art of a sci-fi spaceship, detailed, artstation trending" \
  --output ./spaceship.png \
  --size 1792x1024
```

### Generate creative interpretation

```bash
bun run src/index.ts generate \
  --provider xai \
  --prompt "the feeling of nostalgia as abstract art" \
  --output ./nostalgia.png
```

## Help

View help information:

```bash
bun run src/index.ts --help
```

## License

MIT
