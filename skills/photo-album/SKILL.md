---
name: photo-album
description: Generate hosted themed photo albums with configurable image counts
---

# Photo Album

Generate a hosted premium photo album around a theme, event, campaign, product, or concept. The hosted runtime creates a cohesive image set with configurable image count, style, aspect ratios, cover image, captions, gallery manifest, receipts, and downloadable assets.

## Usage

```
skills run photo-album "autumn in Tokyo" --count 12 --style documentary
skills run photo-album "startup office life" --count 21 --aspect-ratios "1:1,4:5"
skills run photo-album "underwater coral reef exploration" --cover true
```

## Output

- `album/` directory with high-quality images
- `cover.png`
- `captions.csv`
- `gallery-manifest.json`
- `receipt.json`

## Requirements

Hosted premium execution requires `SKILLS_API_KEY` or `skills auth login`.
Provider keys stay server-side.
