---
name: colorextract
description: Extract color palettes from screenshots and images using Claude Vision. Outputs open-styles-compatible profiles.
---

# Color Extract Skill

Analyze any screenshot or image and extract a complete color palette — hex values, usage context, and an open-styles compatible profile.

## Usage

```bash
# Extract from local screenshot
skill-colorextract extract --image ./screenshot.png

# Extract from image URL
skill-colorextract extract --image https://example.com/screenshot.png

# Output as open-styles profile JSON
skill-colorextract extract --image ./screenshot.png --format profile

# Save result to file
skill-colorextract extract --image ./screenshot.png --output ./colors.json
```

## Environment Variables

- `ANTHROPIC_API_KEY` — required for Claude Vision analysis

## Output

Returns a JSON object with:
- `colors`: all extracted colors with hex, name, usage context, frequency estimate
- `palette`: categorized palette (primary, secondary, accent, neutral, background, text)
- `openStylesProfile`: ready-to-import open-styles profile
