---
name: brand-photo-shoot
description: Generate hosted brand or product photo shoot sets
---

# Brand Photo Shoot

Create a hosted premium product or brand photo shoot set with prompt planning, multiple scenes, selectable aspect ratios, gallery exports, captions, manifests, and receipts.

## Usage

```bash
skills run brand-photo-shoot "premium coffee subscription campaign" --scenes 8 --aspect-ratios "1:1,4:5,16:9"
skills run brand-photo-shoot --brief ./brand.md --style "editorial daylight studio"
```

## Output

- `gallery/scene-*.png`
- `prompt-plan.md`
- `captions.csv`
- `manifest.json`
- `receipt.json`

## Requirements

Hosted premium execution requires `SKILLS_API_KEY` or `skills auth login`.
Provider keys stay server-side.
