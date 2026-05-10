# service-salescopygenerate

Sales copy generator using OpenAI GPT.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js
- AI: OpenAI GPT-4o

## CLI

```bash
service-salescopygenerate generate -n "Product" -d "Description" -t sales-letter
service-salescopygenerate generate -n "Product" -d "Description" --template aida --tone urgent
service-salescopygenerate templates list
service-salescopygenerate sessions list
```

## Environment

- `OPENAI_API_KEY` - Required
