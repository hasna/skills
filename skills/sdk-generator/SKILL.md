---
name: sdk-generator
description: Generate a typed TypeScript SDK from an OpenAPI spec or a resource list, including a fetch client with retries, typed errors, per-resource methods, runnable tests, README, API summary, and manifest.
---

# SDK Generator

Generate a complete, ready-to-edit TypeScript SDK package for an API. Point it at an OpenAPI 3 /
Swagger 2 document, or hand it a list of resource names and get a conventional CRUD scaffold.

Everything runs locally. No API keys, no network calls, no accounts.

## Requirements

- [Bun](https://bun.sh) 1.1+ (used to run the CLI and the generated tests).
- `bun install` inside this skill directory. The only runtime dependency is `yaml`, used to parse
  YAML specs. JSON specs parse without it.
- No API keys and no network access.

## Usage

```bash
# From an OpenAPI document (JSON or YAML)
bun run src/index.ts --spec ./openapi.yaml --name petstore-sdk --output ./out

# From a plain resource list (CRUD scaffold)
bun run src/index.ts --resources customers,meters,invoices \
  --name meterkit --base-url https://api.meterkit.dev/v1 --auth api-key

# Machine-readable manifest on stdout
bun run src/index.ts --resources users --output ./out --json
```

Then use the generated package:

```bash
cd ./out/sdk
bun install
bun test          # the generated tests run against a stubbed fetch
bunx tsc --noEmit # the generated source typechecks under strict mode
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --spec <path>` | OpenAPI 3 or Swagger 2 document. `.json` parses as JSON; anything else falls back to YAML. Also accepted as a bare positional argument. | — |
| `-r, --resources <list>` | Comma-separated resource names. Used when there is no spec. | — |
| `-n, --name <pkg>` | Generated package name. Drives the client class name (`meterkit` → `MeterkitClient`). | spec title, or first resource |
| `-b, --base-url <url>` | Default API base URL baked into the client. | first `servers[].url` in the spec, else `https://api.example.com` |
| `-a, --auth <mode>` | `bearer` (`Authorization: Bearer …`), `api-key` (`X-API-Key: …`), or `none`. | `bearer` |
| `-o, --output <dir>` | Output directory. | `./sdk` |
| `--json` | Print `manifest.json` to stdout instead of the text summary. | off |
| `-h, --help` | Show help. | — |
| `-v, --version` | Show version. | — |

Either `--spec` or `--resources` is required.

## Outputs

Written under `--output`:

| File | Contents |
|------|----------|
| `sdk/package.json` | Standalone package manifest with `test` and `typecheck` scripts. |
| `sdk/tsconfig.json` | Strict, `noEmit` config so the generated code typechecks as-is. |
| `sdk/src/index.ts` | Top-level client class wiring every resource, plus re-exports and `DEFAULT_BASE_URL`. |
| `sdk/src/client.ts` | `HttpClient` (configurable base URL, auth header wiring, per-request timeout via `AbortController`, retry with exponential backoff + jitter on 408/429/5xx and network errors, `Retry-After` support) and the typed `ApiError` class. |
| `sdk/src/types.ts` | Interfaces derived from `components.schemas` / `definitions`, or from the resource list, plus a generic `ListResponse<T>`. |
| `sdk/src/resources/<name>.ts` | One class per resource with a method per operation (or `list`/`get`/`create`/`update`/`remove` in resource-list mode). |
| `sdk/test/client.test.ts` | Runnable `bun test` suite against a stubbed fetch: auth headers, query serialization, JSON bodies, `ApiError` shape, 429 retry, retry-budget exhaustion, 204 handling. |
| `sdk/README.md` | Install, usage, client options, error handling, resource index. |
| `api-summary.md` | Operation table, type inventory, and a usage snippet. |
| `usage-examples.md` | Copy-paste snippets per resource. |
| `manifest.json` | Run metadata: source, package info, counts, resource/operation map, file list. |

## Notes

- The generated code is plain TypeScript with `.js` import specifiers, so it works under Bun, Node
  ESM, and bundlers without a build step.
- Path parameters become required positional arguments; query parameters become one optional object
  argument; request bodies become a typed `body` argument.
- Operation names come from `operationId` when present, otherwise from the HTTP verb and path shape
  (`list`, `get`, `create`, `replace`, `update`, `remove`). Collisions get a numeric suffix.
- Resources are grouped by the first OpenAPI tag, falling back to the first static path segment.
- Unresolvable or exotic schemas degrade to `unknown` rather than failing the run.
