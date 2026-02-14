# service-voiceovergenerate

Generate voiceovers using ElevenLabs and OpenAI TTS.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js
- AI: OpenAI TTS, ElevenLabs API

## Project Structure

```
├── bin/cli.ts
├── src/
│   ├── commands/
│   │   ├── generate.ts
│   │   ├── voices.ts
│   │   └── config.ts
│   ├── lib/
│   │   ├── generator.ts
│   │   └── storage.ts
│   ├── types/index.ts
│   └── utils/
├── legacy/
└── package.json
```

## CLI

```bash
service-voiceovergenerate generate "Hello" -p openai -v alloy
service-voiceovergenerate voices elevenlabs
```

## Environment

- `OPENAI_API_KEY` - For OpenAI TTS
- `ELEVENLABS_API_KEY` - For ElevenLabs
