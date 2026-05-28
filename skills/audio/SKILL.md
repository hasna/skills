---
name: audio
description: Generate speech and audio using OpenAI, Minimax, or Gemini through the hosted Skills runtime with provider-cost pricing.
---

# Audio Generation Skill

Generate speech or short audio from text using provider-backed audio models. This skill routes through the hosted Skills runtime so billing can reserve the selected provider/model cost before execution.

## Supported Providers

- `openai`: `tts-1`, `tts-1-hd`
- `minimax`: `speech-2.8-turbo`, `speech-2.8-hd`
- `gemini`: `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`

## Usage

```bash
audio generate --provider openai --text "Welcome to Skills.md" --voice alloy --output ./voice.mp3
audio generate --provider minimax --model speech-2.8-turbo --text "Fast narration" --output ./voice.mp3
audio generate --provider gemini --text "Studio announcement" --output ./voice.wav
```

## Options

- `--provider`: `openai`, `minimax`, or `gemini`
- `--model`: provider model override
- `--text`: text to synthesize
- `--voice`: provider-specific voice
- `--format`: output format such as `mp3`, `wav`, or `opus`
- `--output`: output file path

## Environment

- `SKILL_API_KEY`: required for hosted runtime execution
