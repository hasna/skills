---
name: Music
version: 0.1.0
description: Generate music tracks using AI models (Minimax Music-01)
category: Content Generation
tags:
  - music
  - generation
  - ai
  - minimax
---

# Music

Generate full music tracks from text descriptions using AI. Describe the genre, mood, tempo, and style — get a complete audio track. Supports lyrics, instrumental references, and fine-grained control over the output.

## Features

- **Text-to-Music**: Describe any style and get a full track
- **Lyrics Support**: Provide lyrics for vocal tracks
- **Genre & Mood Control**: Specify genre, mood, and tempo
- **Duration Control**: Set desired track length

## Usage

```bash
skill-music generate --prompt "upbeat jazz piano" --output ./jazz.mp3
skill-music generate --prompt "rock anthem" --lyrics "We are the champions" --output ./rock.mp3
skill-music generate --prompt "lo-fi beats" --mood calm --tempo 80 --output ./lofi.mp3
```

## Environment Variables

- `MINIMAX_API_KEY` — API key for Minimax (required)
- `MINIMAX_GROUP_ID` — Group ID for Minimax (optional)
