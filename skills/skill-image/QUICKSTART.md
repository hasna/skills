# Quick Start Guide

Get started with the Image Generation Skill in 3 easy steps.

## Step 1: Set up API Keys

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
# Edit .env with your favorite editor and add your API keys
```

Or export them directly:

```bash
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
export GOOGLE_PROJECT_ID="your-project-id"
export XAI_API_KEY="..."
```

## Step 2: Generate Your First Image

Choose a provider and run:

```bash
# OpenAI
bun run src/index.ts generate \
  --provider openai \
  --prompt "a beautiful sunset over mountains" \
  --output ./my-first-image.png

# Google
bun run src/index.ts generate \
  --provider google \
  --prompt "a beautiful sunset over mountains" \
  --output ./my-first-image.png

# xAI
bun run src/index.ts generate \
  --provider xai \
  --prompt "a beautiful sunset over mountains" \
  --output ./my-first-image.png
```

## Step 3: Explore Advanced Options

### Custom Sizes

OpenAI sizes:
```bash
bun run src/index.ts generate \
  -p openai \
  --prompt "wide landscape" \
  -o ./landscape.png \
  --size 1792x1024
```

Google aspect ratios:
```bash
bun run src/index.ts generate \
  -p google \
  --prompt "portrait photo" \
  -o ./portrait.png \
  --size 3:4
```

### Run Example Scripts

```bash
cd examples
./openai-examples.sh
./google-examples.sh
./xai-examples.sh
```

## Tips

1. **Prompt Engineering**: Be specific and descriptive in your prompts
2. **Size Selection**: Choose the right size for your use case
   - Square (1024x1024, 1:1): Social media posts, avatars
   - Landscape (1792x1024, 16:9): Banners, headers
   - Portrait (1024x1792, 9:16): Mobile wallpapers, stories
3. **Provider Selection**:
   - OpenAI: Great for detailed, creative images
   - Google: Best for photorealistic results
   - xAI: Excellent for artistic interpretation

## Troubleshooting

### "API key required" error
Make sure your environment variables are set correctly.

### "Invalid size" error
Check the provider-specific size options in the help:
```bash
bun run src/index.ts --help
```

### Image quality issues
Try being more specific in your prompt or experiment with different providers.

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [SKILL.md](SKILL.md) for skill metadata
- Explore the [examples/](examples/) directory for more use cases
- Review [src/](src/) for implementation details

Happy image generation!
