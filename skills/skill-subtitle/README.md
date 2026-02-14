# service-subtitlegenerate

Generate styled subtitles from audio using OpenAI Whisper.

## Features

- Multiple formats: SRT, VTT, ASS (styled), JSON
- ASS styling: custom fonts, colors, outline, shadow
- Automatic segment splitting and timing optimization

## Installation

```bash
bun install -g @hasnaxyz/service-subtitlegenerate
```

## Quick Start

```bash
export OPENAI_API_KEY=sk-...

# Generate SRT subtitles
service-subtitlegenerate generate video.mp4

# Generate styled ASS subtitles
service-subtitlegenerate generate video.mp4 -f ass --font "Arial" --font-size 24

# Generate WebVTT
service-subtitlegenerate generate video.mp4 -f vtt
```

## CLI Commands

### generate

```bash
service-subtitlegenerate generate <file> [options]

Options:
  -f, --format <format>     Output: srt, vtt, ass, json (default: srt)
  -l, --language <code>     Language code
  --font <name>             Font name (ASS format)
  --font-size <size>        Font size (ASS format)
  --outline <size>          Outline size (ASS format)
  --shadow <size>           Shadow size (ASS format)
```

### config

```bash
service-subtitlegenerate config view
service-subtitlegenerate config set defaultFormat ass
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...       # Required
```

## License

MIT
