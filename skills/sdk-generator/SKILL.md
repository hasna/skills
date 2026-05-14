---
name: sdk-generator
description: Generate premium SDK scaffolds with typed client code, package files, tests, README, usage examples, API summary, and manifest.
---

# SDK Generator

Generate a ready-to-edit TypeScript SDK scaffold for an API, SaaS product, internal service, or developer platform.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run sdk-generator "Billing API for usage meters and invoices" --name "meterkit" --resources "customers,meters,invoices"
skills run sdk-generator --api "Project management API" --base-url "https://api.example.com" --auth api-key
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--api <text>` | API or product description. Positional text also works. | required |
| `--name <text>` | SDK package name stem. | derived from API description |
| `--base-url <url>` | Default API base URL. | https://api.example.com |
| `--auth <mode>` | `bearer`, `api-key`, or `none`. | bearer |
| `--resources <list>` | Comma-separated resource names. | users,projects,events |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `sdk/package.json`
- `sdk/src/index.ts`
- `sdk/src/client.ts`
- `sdk/src/types.ts`
- `sdk/test/client.test.ts`
- `sdk/README.md`
- `usage-examples.md`
- `api-summary.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
