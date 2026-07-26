---
name: api-docs-portal
description: Generate a self-contained static API documentation portal, normalized endpoint JSON, and a markdown reference from an OpenAPI 3.x or Swagger 2.0 spec.
---

# API Docs Portal

Turn an OpenAPI/Swagger document into a browsable static portal. Everything is
generated locally and deterministically: no network calls, no credentials, and
the emitted HTML makes no external requests.

## What It Does

- Reads OpenAPI 3.x or Swagger 2.0 specs in JSON or YAML.
- Resolves local `$ref` pointers (`#/components/schemas/...`, `#/definitions/...`) with a cycle guard, so referenced request/response schemas render inline.
- Groups endpoints by their first tag, falling back to the first path segment.
- Renders method, path, summary, description, deprecation, path/query/header/cookie parameters (including path-level shared parameters), request body fields, and per-status response fields.
- Flattens nested object schemas up to three levels and labels types (`string<uuid>`, `object[]`, `string (open | paid | cancelled)`, `A | B`).
- Extracts security schemes and per-operation security requirements, and generates a cURL example per endpoint.

## Requirements

- [Bun](https://bun.sh) 1.x
- npm dependency: `yaml` (install once with `bun install` in this skill directory) — only needed for YAML specs, JSON specs parse natively
- An OpenAPI/Swagger document with a `paths` object. External (`http://`, `other.yaml#/...`) `$ref`s are not fetched; they are marked as unresolved in the output.

## Usage

```bash
# Generate the portal into ./api-portal
skills run api-docs-portal -- --spec ./openapi.yaml

# Dark theme, custom output directory and base URL
skills run api-docs-portal -- --spec ./openapi.json --output ./docs/api \
  --theme slate --base-url https://api.example.com/v2

# Machine-readable summary on stdout
skills run api-docs-portal -- --spec ./openapi.yaml --json
```

Then open `./api-portal/index.html` in a browser. Run it directly from the skill
directory with `bun run src/index.ts --spec ./openapi.yaml`.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --spec <path>` | OpenAPI/Swagger document, JSON or YAML (also accepted positionally) | required |
| `-o, --output <dir>` | Output directory | `./api-portal` |
| `--theme <name>` | `light` or `slate` | `light` |
| `--base-url <url>` | Base URL shown in the portal and cURL examples | first `servers[].url` |
| `--title <text>` | Override the portal title | spec `info.title` |
| `--json` | Print a JSON summary on stdout | off |
| `--help` | Show usage | |
| `--version` | Show version | |

## Outputs

Written into `--output` (default `./api-portal`):

| File | Contents |
|------|----------|
| `index.html` | Self-contained portal: inline CSS, sticky sidebar navigation, responsive layout, zero external requests (no CDN scripts, fonts, or images) |
| `endpoints.json` | Normalized endpoint model (method, path, group, params, request body fields, response fields, security) |
| `reference.md` | Markdown API reference with parameter/field tables and cURL examples |

Without `--json`, a summary is printed to stdout:

```
api-docs-portal: /abs/path/openapi.yaml
  title      Orders API v2.1.0
  base url   https://api.example.com/v2
  theme      slate
  endpoints  5 in 2 groups
    customers: 1
    orders: 4
  output     /abs/path/api-portal
  files      index.html, endpoints.json, reference.md
```

## Exit Codes

- `0` — portal generated
- `1` — missing/unreadable spec, invalid JSON/YAML, no `paths` object, no operations, or an invalid option value
