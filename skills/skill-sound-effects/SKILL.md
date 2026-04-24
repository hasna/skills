---
name: sound-effects
version: 0.1.0
description: Generate sound effects using AI models (Minimax)
category: Media Processing
tags:
  - audio
  - sound-effects
  - sfx
  - ai
  - generation
---

# Sound Effects

Generate realistic sound effects from text descriptions using AI. Describe any sound — thunder, footsteps, explosions, ambient noise — and get a high-quality audio file.

## Features

- **Text-to-SFX**: Describe any sound and get an audio file
- **Duration Control**: Set the desired length of the sound effect
- **Multiple Formats**: Output to MP3, WAV, or other audio formats

## Usage

```bash
skill-sound-effects generate --prompt "thunder rolling in the distance" --output ./thunder.mp3
skill-sound-effects generate --prompt "footsteps on gravel" --duration 5 --output ./steps.mp3
skill-sound-effects generate --prompt "spaceship engine humming" --output ./engine.mp3
```

## Environment Variables

- `MINIMAX_API_KEY` — API key for Minimax (required)
