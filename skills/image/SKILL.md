---
name: image
description: Generate images using OpenAI, Minimax, or Gemini through the hosted Skills runtime with an approved credit quote.
---

# Image Generation Skill

Generate high-quality images from text prompts using provider-backed image models.

This CLI is API-backed. Set `SKILLS_API_KEY` when routing through the Skills cloud runtime; provider-specific keys stay server-side, and execution uses an approved credit quote.

## Supported Providers

### OpenAI
- **Models**: gpt-image-1.5, dall-e-3
- **Sizes**: 1024x1024, 1792x1024, 1024x1792

### Minimax
- **Models**: image-01
- **Sizes**: Provider-specific aspect ratios

### Gemini
- **Models**: imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001, gemini-2.5-flash-image
- **Sizes**: Configurable aspect ratios

## Usage

```bash
# OpenAI
image generate --provider openai --prompt "a cat" --output ./output.png

# Minimax
image generate --provider minimax --prompt "a dog" --output ./output.png

# Gemini Imagen
image generate --provider gemini --model imagen-4.0-fast-generate-001 --prompt "a bird" --output ./output.png
```

## Options

- `--provider`: Provider to use (openai, minimax, gemini)
- `--prompt`: Text prompt for image generation
- `--output`: Output file path
- `--model`: (Optional) Specific model to use
- `--size`: (Optional) Image size (provider-specific)

## Environment Variables

Set `SKILLS_API_KEY` for hosted runtime execution.
