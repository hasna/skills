---
name: Generate Audio
version: 1.0.0
description: Generate audio with customizable options
author: skills.md
category: Design & Creative
tags:
  - design
  - creative
  - ai
  - audio
---
--file script.txt --output narration.mp3
```

## Options

| Option       | Description                                      | Default |
| ------------ | ------------------------------------------------ | ------- |
| `<text>`     | Text to speak (positional arg)                   | -       |
| `--voice`    | Voice ID or name (e.g. "Rachel", "Alloy")          | rachel  |
| `--model`    | AI model (`v3`, `turbo`, `tts-1-hd`)             | v2      |
| `--file`     | Read text from file                              | -       |
| `--output`   | Custom output path                               | (auto)  |
| `--stability`| Voice stability (0-1, ElevenLabs only)           | 0.5     |

## Output

- **Audio File**: The generated speech file.
- **Log**: Details about the generation settings.

## Examples

### Podcast Intro
```bash
skills run generate-audio -- "You're listening to The Daily Tech."
  --voice "Adam"
  --quality ultra
```

### App Notification
```bash
skills run generate-audio -- "Your ride has arrived."
  --model tts-1
  --voice nova
```

## Requirements

- `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`.
- Bun runtime.

```