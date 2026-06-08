---
name: supply-chain-audit
description: Offline repository security audit for leaked secrets, risky install scripts, and dependency issues. Windows / PowerShell / cmd. Tags: security, audit, supply-chain. Use when supply chain audit, npm install script risk, dependency security review, before publishing a skill.
displayName: Supply Chain Security Audit
category: Development Tools
tags: [security, audit, supply-chain, dependencies, npm, hardening, developer-tools, cli]
---

# Supply Chain Security Audit

Local security audit aligned with demand on [skills.sh/audits](https://www.skills.sh/audits) — secrets, dependencies, install scripts, config leaks.

## What It Does

- Audits package.json scripts for postinstall/preinstall risk
- Reviews lockfiles and dependency sources for supply-chain red flags
- Checks for typosquatting patterns and unexpected git dependencies
- Outputs offline supply-chain security report

## Quick start

```bash
skills run supply-chain-audit --checklist
skills run supply-chain-audit path=. --json
```

## Quick start

```bash
skills run supply-chain-audit --checklist
skills run supply-chain-audit path=. --json
```

## Quick start

```bash
skills run supply-chain-audit --checklist
skills run supply-chain-audit path=. --json
```

## Usage

```bash
skills run supply-chain-audit path=.
```

```bash
skills run supply-chain-audit path=./src output=audit-report.md
```

```bash
skills run supply-chain-audit --path . --json
```

## Options

| Option | Description |
|--------|-------------|
| `path=<dir>` | Directory to scan (default `.`) |
| `output=<file>` | Write Markdown report |
| `--json` | Machine-readable JSON |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No findings |
| 1 | Medium/low findings |
| 2 | Critical findings |

## Requirements

- Bun runtime
- No API keys; fully offline scan
