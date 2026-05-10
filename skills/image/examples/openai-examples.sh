#!/bin/bash

# OpenAI DALL-E 3 Examples

# Basic square image
bun run ../src/index.ts generate \
  --provider openai \
  --prompt "a serene mountain lake at sunset with reflections" \
  --output ./openai-lake-square.png

# Landscape format
bun run ../src/index.ts generate \
  --provider openai \
  --prompt "a panoramic view of a futuristic city skyline at night" \
  --output ./openai-city-landscape.png \
  --size 1792x1024

# Portrait format
bun run ../src/index.ts generate \
  --provider openai \
  --prompt "a towering ancient tree in a mystical forest" \
  --output ./openai-tree-portrait.png \
  --size 1024x1792

# Abstract art
bun run ../src/index.ts generate \
  --provider openai \
  --prompt "abstract geometric shapes in vibrant colors, minimalist design" \
  --output ./openai-abstract.png

# Photorealistic
bun run ../src/index.ts generate \
  --provider openai \
  --prompt "photorealistic portrait of a golden retriever, studio lighting, professional photography" \
  --output ./openai-dog-photo.png
