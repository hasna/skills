# logo-design

AI logo design generator using the connectors REST API.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- CLI: Commander.js
- Backend: connectors REST API (plain fetch, no SDK dependency)

## CLI

```bash
logo-design generate <prompt> [options]
logo-design providers
logo-design tips
```

## Architecture

Calls the connectors REST API directly via `fetch()`:
- `POST /api/connectors/openai/operations/run` → `images generate` (gpt-image-1)
- `POST /api/connectors/googlegemini/operations/run` → `image generate` (Nano Banana)

The connectors server must be running on port 19426 (default).

## Environment

No direct API keys needed — keys are managed by the connectors server.
