---
name: migration-plan-pack
description: Generate premium migration planning packs for framework, library, database, infrastructure, or architecture upgrades with risk matrix, checklist, rollout plan, and test strategy.
---

# Migration Plan Pack

Generate a migration package from current state, target state, system context, and operating constraints. Hosted runs can inspect richer project inputs, while local direct execution produces deterministic artifacts for validation.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run migration-plan-pack --system "Acme SaaS" --from "Next.js 14, Postgres 14" --to "Next.js 16, Postgres 16"
skills run migration-plan-pack --from "single-region worker" --to "multi-region worker" --constraints "no downtime, preserve RLS"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--system <text>` | Product, repo, app, or service being migrated. | Migration Target |
| `--from <text>` | Current framework, library, database, infrastructure, or architecture state. | current state |
| `--to <text>` | Desired target state. | target state |
| `--scope <list>` | Comma-separated systems or workstreams in scope. | app, data, deploy, tests |
| `--constraints <text>` | Risk, downtime, compliance, billing, or operational constraints. | optional |
| `--deadline <text>` | Date, release train, or migration window. | optional |
| `--strategy <type>` | `phased`, `big-bang`, or `parallel-run`. | phased |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `migration-plan.md`
- `risk-matrix.csv`
- `ordered-checklist.md`
- `test-strategy.md`
- `dependency-map.json`
- `rollout-plan.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
