---
name: short-video-pack
description: Generate hosted short-form video packs from a creative brief
---

# Short Video Pack

Create a hosted premium short-form video package from a brief, product, recording, campaign, or script. The hosted runtime prepares scripts, shot lists, generated clips or edit packages, captions, thumbnails, manifests, and receipts.

## Usage

```bash
skills run short-video-pack "three launch videos for an AI billing app" --platforms "tiktok,youtube-shorts,linkedin"
skills run short-video-pack --brief ./campaign.md --count 5 --aspect-ratio 9:16
```

## Output

- `videos/clip-*.mp4` or edit package references
- `scripts.md`
- `shot-list.csv`
- `captions.srt`
- `thumbnails/`
- `manifest.json`
- `receipt.json`

## Requirements

Hosted premium execution requires `SKILLS_API_KEY` or `skills auth login`.
Provider keys stay server-side.
