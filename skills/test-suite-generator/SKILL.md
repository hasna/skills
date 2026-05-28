---
name: test-suite-generator
description: Generate premium API, unit, and browser test suite packages with runnable tests and coverage notes.
---

# Test Suite Generator

Generate a test package for SaaS apps from routes, specs, or user flows.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run test-suite-generator --spec "POST /api/projects, GET /api/projects/:id" --framework "Next.js" --runner "bun"
skills run test-suite-generator "signup, checkout, billing success" --include-browser
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--spec <text>` | Routes, specs, or user flows. Positional text also works. | required |
| `--framework <name>` | Application framework. | generic SaaS app |
| `--runner <name>` | Test runner style: `bun`, `vitest`, or `playwright`. | bun |
| `--include-browser` | Include browser flow tests. | false |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `tests/api.test.ts`
- `tests/unit.test.ts`
- `tests/browser.spec.ts`
- `test-plan.md`
- `coverage-notes.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
