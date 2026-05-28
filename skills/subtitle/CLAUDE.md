# service-subtitlegenerate

Generate styled subtitles from audio using OpenAI Whisper.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js
- AI: OpenAI Whisper

## Project Structure

```
├── bin/cli.ts
├── src/
│   ├── commands/
│   │   ├── generate.ts
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
service-subtitlegenerate generate video.mp4 -f ass
```

## Environment

- `OPENAI_API_KEY` - Required
