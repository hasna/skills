---
name: logo-design
description: Generate professional logos using AI (OpenAI GPT Image, Google Gemini Nano Banana)
---

# Logo Design Skill

Generate professional logo designs from text descriptions using multiple AI image providers via the connectors REST API.

## Providers

### OpenAI GPT Image
- **Model**: gpt-image-1
- **Sizes**: 1024x1024, 1536x1024, 1024x1536
- **Best for**: Clean vector-style logos, text rendering, minimal designs
- **Connector**: `openai` (requires API key configured)

### Google Gemini (Nano Banana)
- **Model**: gemini-2.5-flash-preview-image-generation
- **Sizes**: Configurable aspect ratios (1:1, 16:9, 9:16)
- **Best for**: Creative exploration, stylized concepts, detailed compositions
- **Connector**: `googlegemini` (requires API key configured)

## Usage

```bash
# Generate with OpenAI GPT Image (default)
logo-design generate "minimalist geometric owl logo, flat vector, navy and gold, white background"

# Generate with Gemini
logo-design generate --provider gemini "modern tech startup logo, abstract hexagon, clean lines"

# Save to specific file
logo-design generate --output ./my-logo.png "coffee shop logo, vintage style, warm tones"

# Generate multiple variations
logo-design generate --variations 4 "mountain peak logo, minimalist, black and white"

# List available providers and their status
logo-design providers
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--provider` | Provider: `openai` or `gemini` | `openai` |
| `--output` / `-o` | Output file path | `./logo_{timestamp}.png` |
| `--variations` / `-n` | Number of variations | `1` |
| `--size` / `-s` | Image size (OpenAI: 1024x1024, etc.) | `1024x1024` |
| `--aspect-ratio` / `-a` | Aspect ratio for Gemini (1:1, 16:9) | `1:1` |
| `--quality` / `-q` | Quality level (openai: standard/hd) | `hd` |
| `--server` | Connectors server URL | `http://localhost:19426` |

## Logo Design Tips

1. **Be specific**: "minimalist geometric owl logo, flat vector, navy and gold, white background" beats "owl logo"
2. **Specify style**: flat vector, 3D, vintage, modern, hand-drawn, geometric, abstract
3. **Request white/solid background**: Prevents complex backgrounds bleeding into the mark
4. **Keep it simple**: Logos must work at favicon size (16x16). Ask for clean, minimal designs
5. **Skip text in the logo**: AI models struggle with typography. Generate the icon, add text in Illustrator/Figma
6. **Generate many variations**: Run 4-10 variations with slight prompt tweaks, pick the best

## Prerequisites

The connectors server must be running with OpenAI and/or Google Gemini connectors configured:

```bash
connectors serve    # Start connectors server on port 19426
```
