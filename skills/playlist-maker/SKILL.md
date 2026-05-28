---
name: playlist-maker
description: Create a curated playlist with research, track selection, and AI-generated album art
---

# Playlist Maker

Create a themed music playlist by researching artists and tracks, selecting 7 songs that fit the mood, and generating custom album artwork.

## What it does

1. Takes a theme, mood, or artist as input
2. Searches the web for relevant tracks, reviews, and playlists
3. Selects 7 tracks that form a cohesive listening experience
4. Generates custom album art that captures the playlist vibe
5. Outputs a structured playlist with track info and cover image

## Usage

```
playlist-maker "late night jazz for coding"
playlist-maker "90s hip hop summer vibes"
playlist-maker "songs similar to Radiohead OK Computer"
```

## Output

- `playlist.json` — structured playlist with track names, artists, and why each was chosen
- `cover.png` — AI-generated album art for the playlist

## Credits

30 credits per playlist (web search + image generation).
