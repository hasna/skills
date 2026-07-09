---
name: deepresearch
description: Run hosted deep research with parallel search, synthesis, citations, source notes, and downloadable report artifacts.
---

# Deep Research

Deep Research is a hosted premium skill. The OSS package exposes public
metadata and usage guidance only; search providers, model routing, prompts,
worker orchestration, and credentials stay server-side.

## Usage

```bash
skills setup --mode self-hosted
skills auth login
skills run deepresearch "Best practices for building production RAG systems" --depth normal
skills runs status <run-id>
skills exports download <run-id>
```

## Options

| Option | Description | Default |
| --- | --- | --- |
| `--depth <level>` | Research depth: `quick`, `normal`, or `deep` | `normal` |
| `--output <path>` | Requested output path inside the exported artifact bundle | hosted export |
| `--json` | Request raw source metadata in the exported bundle | `false` |

## Requirements

- Authenticate with `skills auth login` or provide `SKILLS_API_KEY`.
- Provider credentials are managed by the hosted runtime and are not part of the
  OSS package.

## Outputs

- Research report
- Source notes
- Citation metadata
- Run manifest
