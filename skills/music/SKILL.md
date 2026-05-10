---
name: music
description: Generate music using Minimax or Gemini Lyria through the hosted Skills runtime with provider-cost pricing.
---

# Music Generation Skill

Generate songs, stems, or short music clips from prompts and lyrics using provider-backed music models. This skill routes through the hosted Skills runtime so billing can reserve the selected provider/model cost before execution.

## Supported Providers

- `minimax`: `Music-2.6`, `Music-2.0`
- `gemini`: `lyria-3-clip-preview`, `lyria-3-pro-preview`

## Usage

```bash
music generate --provider minimax --prompt "upbeat synth pop intro" --lyrics ./lyrics.txt --output ./song.mp3
music generate --provider gemini --model lyria-3-clip-preview --prompt "30 second ambient ident" --output ./clip.wav
```

## Options

- `--provider`: `minimax` or `gemini`
- `--model`: provider model override
- `--prompt`: musical direction
- `--lyrics`: lyrics text or file path
- `--duration`: requested duration in seconds
- `--output`: output file path

## Environment

- `SKILL_API_KEY`: required for hosted runtime execution
