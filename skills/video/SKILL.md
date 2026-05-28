---
name: video
description: Generate videos using OpenAI Sora, Minimax Hailuo, Gemini Veo, or Seedance through the hosted Skills runtime with provider-cost pricing.
---

# Video Generation Skill

Generate short videos from text prompts or image references using provider-backed video models. This skill routes through the hosted Skills runtime so billing can reserve the selected provider/model cost before execution.

## Supported Providers

- `openai`: `sora-2`, `sora-2-pro`
- `minimax`: `MiniMax-Hailuo-2.3-Fast`, `MiniMax-Hailuo-2.3`
- `gemini`: `veo-3.1-fast-generate-preview`, `veo-3.1-generate-preview`
- `seedance`: `dreamina-seedance-2.0`, `dreamina-seedance-2.0-fast`

## Usage

```bash
video generate --provider seedance --prompt "cinematic product reveal" --duration 6 --output ./video.mp4
video generate --provider openai --model sora-2 --prompt "aerial city sunrise" --duration 10 --output ./video.mp4
video generate --provider gemini --model veo-3.1-fast-generate-preview --prompt "chef plating dessert" --output ./video.mp4
```

## Options

- `--provider`: `openai`, `minimax`, `gemini`, or `seedance`
- `--model`: provider model override
- `--prompt`: text prompt
- `--image`: optional reference image path or URL
- `--duration`: requested duration in seconds
- `--size`: provider-specific size or aspect ratio
- `--output`: output file path

## Environment

- `SKILL_API_KEY`: required for hosted runtime execution
