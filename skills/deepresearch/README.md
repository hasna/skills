# Deep Research

Hosted premium research skill for comprehensive reports with source notes,
citations, and downloadable artifacts.

## Usage

```bash
skills setup --mode self-hosted
skills auth login
skills mcp --register
skills run deepresearch "Compare React Server Components with traditional SSR" --depth deep
```

Poll and download results:

```bash
skills runs status <run-id>
skills exports download <run-id>
```

## Boundary

The OSS package contains metadata and documentation only. Provider credentials,
model routing, private prompts, search orchestration, worker code, billing, and
artifact storage are owned by the hosted platform.
