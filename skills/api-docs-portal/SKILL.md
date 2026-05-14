---
name: api-docs-portal
description: Generate premium API documentation portals from OpenAPI specs, route lists, or examples.
---

# API Docs Portal

Generate a polished API documentation portal from OpenAPI specs, route files, or endpoint examples.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run api-docs-portal --spec "GET /v1/projects, POST /v1/projects" --title "Acme API"
skills run api-docs-portal --spec-file ./openapi.json --base-url "https://api.example.com" --auth bearer
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--spec <text>` | OpenAPI JSON, route list, or endpoint examples. Positional text also works. | required |
| `--spec-file <path>` | Read the API spec or route list from a file. | none |
| `--title <text>` | Portal and API title. | API Documentation |
| `--base-url <url>` | Base URL used in examples. | https://api.example.com |
| `--auth <mode>` | Auth mode: `bearer`, `api-key`, `oauth`, `session`, or `none`. | bearer |
| `--theme <name>` | Portal theme: `light` or `slate`. | light |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `site/index.html`
- `site/styles.css`
- `site/endpoints.json`
- `openapi.json`
- `endpoint-reference.md`
- `auth-guide.md`
- `examples.md`
- `README.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
