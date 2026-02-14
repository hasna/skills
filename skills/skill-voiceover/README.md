# service-voiceovergenerate

Generate voiceovers using ElevenLabs and OpenAI TTS.

## Installation

```bash
bun install -g @hasnaxyz/service-voiceovergenerate
```

## Quick Start

```bash
# Using OpenAI
export OPENAI_API_KEY=sk-...
service-voiceovergenerate generate "Hello world" -v alloy

# Using ElevenLabs
export ELEVENLABS_API_KEY=...
service-voiceovergenerate generate "Hello world" -p elevenlabs -v 21m00Tcm4TlvDq8ikWAM

# List voices
service-voiceovergenerate voices openai
service-voiceovergenerate voices elevenlabs
```

## CLI Commands

### generate

```bash
service-voiceovergenerate generate <text> [options]

Options:
  -p, --provider <provider>  openai or elevenlabs (default: openai)
  -v, --voice <voice>        Voice ID (default: alloy)
  -s, --speed <speed>        Speed 0.25-4.0 (OpenAI only)
  --stability <value>        Stability 0-1 (ElevenLabs)
  --similarity <value>       Similarity 0-1 (ElevenLabs)
```

### voices

```bash
service-voiceovergenerate voices [provider]
```

### config

```bash
service-voiceovergenerate config view
service-voiceovergenerate config set defaultProvider elevenlabs
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...           # For OpenAI TTS
ELEVENLABS_API_KEY=...          # For ElevenLabs
```

## License

MIT
