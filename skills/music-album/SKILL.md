---
name: music-album
description: Generate hosted music album packages with 7, 14, or 21 songs
---

# Music Album

Create a hosted premium album package from a concept, genre, mood, or campaign brief. The hosted runtime generates a cohesive album plan, 7, 14, or 21 songs, cover art direction, track metadata, manifests, receipts, and downloadable artifacts.

## Usage

```bash
skills run music-album "ambient synth album for deep work" --songs 7
skills run music-album "high-energy product launch soundtrack" --songs 14 --genre "electro pop"
skills run music-album "cinematic fantasy travel album" --songs 21 --lyrics-mode instrumental
```

## Options

- `--songs <7|14|21>`: Album size.
- `--genre <text>`: Genre or style lane.
- `--lyrics-mode <instrumental|vocal|mixed>`: Lyric direction.
- `--cover-style <text>`: Cover art direction.
- `--reference <path-or-url>`: Optional brand, mood, or story reference.

## Output

- `album/track-*.mp3` or provider-native audio files
- `album/cover.png`
- `album/tracklist.json`
- `album/manifest.json`
- `album/receipt.json`

## Requirements

Hosted premium execution requires `SKILLS_API_KEY` or `skills auth login`.
Provider keys stay server-side.
