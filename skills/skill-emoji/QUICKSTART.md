# Quick Start Guide

Generate your first emoji pack in 2 minutes.

## Step 1: Set up API Key

```bash
export OPENAI_API_KEY="sk-..."
```

## Step 2: Generate Emojis

```bash
cd skill-emoji
bun install
bun run src/index.ts generate --theme "Christmas" --count 5
```

## Step 3: Check Output

```bash
ls -la emoji-christmas/
open emoji-christmas/
```

## Examples

```bash
# Food emojis
bun run src/index.ts generate -t "Food" -c 10

# Weather as zip
bun run src/index.ts generate -t "Weather" -c 6 -f zip

# Large 3D animals
bun run src/index.ts generate -t "Animals" -c 8 --style 3d -s 256

# Office icons
bun run src/index.ts generate -t "Office and Work" -c 12
```

## Output

Each run creates:
- Individual PNG files (128x128 by default)
- `manifest.json` with metadata

## Next Steps

- Read full [README.md](README.md)
- Check [SKILL.md](SKILL.md) for skill metadata
- Try different themes and styles
