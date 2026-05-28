---
name: repo-onboarding-report
description: Generate premium repository onboarding reports with architecture maps, setup guides, first-week plans, code inventory, risk register, and manifest metadata.
---

# Repo Onboarding Report

Generate a practical onboarding package for a software repository so a new engineer or agent can understand the codebase, setup path, architecture, risks, and first useful tasks quickly.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run repo-onboarding-report --target ./my-app --name "Acme Web App" --stack "Next.js SaaS"
skills run repo-onboarding-report --target . --focus "architecture,setup,testing,risks"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <path>` | Repository directory to inspect. | current directory |
| `--name <text>` | Project name used in report titles. | package name or folder name |
| `--stack <text>` | Stack or product context. | inferred from repository files |
| `--focus <list>` | Comma-separated focus areas. | architecture,setup,testing,risks,first-week |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `repo-onboarding-report.md`
- `architecture-map.md`
- `setup-quickstart.md`
- `first-week-plan.md`
- `code-inventory.json`
- `risk-register.json`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
