#!/bin/bash

# Google Imagen 3 Examples

# Square format (1:1)
bun run ../src/index.ts generate \
  --provider google \
  --prompt "a peaceful zen garden with raked sand and stones" \
  --output ./google-zen-square.png \
  --size 1:1

# Wide format (16:9)
bun run ../src/index.ts generate \
  --provider google \
  --prompt "a cinematic wide shot of a desert highway at golden hour" \
  --output ./google-highway-wide.png \
  --size 16:9

# Vertical format (9:16)
bun run ../src/index.ts generate \
  --provider google \
  --prompt "a tall waterfall cascading down a cliff face" \
  --output ./google-waterfall-vertical.png \
  --size 9:16

# Photorealistic portrait
bun run ../src/index.ts generate \
  --provider google \
  --prompt "photorealistic portrait of a woman with curly hair, natural lighting, soft focus background" \
  --output ./google-portrait.png \
  --size 3:4

# Nature scene
bun run ../src/index.ts generate \
  --provider google \
  --prompt "a misty morning in a pine forest with sunbeams filtering through trees" \
  --output ./google-forest.png
