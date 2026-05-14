---
name: security-audit-report
description: Generate a premium security hardening report covering auth, secrets, headers, webhooks, RLS, permissions, dependency risk, and prioritized fixes.
---

# Security Audit Report

Generate a security hardening package for SaaS and developer tooling projects.

## Requirements

- Authenticate with `skills auth login`.
- This premium skill runs through the hosted Skills runtime; local installs expose only metadata and instructions.

## Usage

```bash
skills run security-audit-report --target ./app --scope "auth,secrets,headers,webhooks,rls"
skills run security-audit-report --target ./src --framework "Next.js"
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <path>` | Directory to inspect. | current directory |
| `--scope <list>` | Comma-separated focus areas. | auth,secrets,headers,webhooks,rls,permissions,dependencies |
| `--framework <name>` | App stack context for recommendations. | generic web app |
| `--output <dir>` | Output directory for direct local execution. Hosted runs use the run export directory. | run export dir |

## Outputs

- `security-audit-report.md`
- `security-audit-report.pdf`
- `findings.json`
- `findings.csv`
- `remediation-plan.md`
- `manifest.json`

After submitting a hosted run, poll with `skills runs status <run-id>` and download outputs with `skills exports download <run-id>`.
