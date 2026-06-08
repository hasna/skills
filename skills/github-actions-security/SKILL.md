---
name: github-actions-security
description: Review GitHub Actions workflows for unpinned actions, secret exposure, and supply-chain risks. Windows / PowerShell / cmd. Tags: security, github-actions, ci. Use when github actions security, unpinned actions, workflow yaml audit, ci hardening.
displayName: Github Actions Security
category: Development Tools
tags: [security, github-actions, ci, workflow, supply-chain, audit, hardening, dependencies]
---

# Github Actions Security


## When users ask (skills.sh search)

- github actions security
- unpinned actions
- workflow yaml audit
- ci hardening
- unpinned github actions

## What It Does

- Audits .github/workflows YAML for unpinned action versions (@v3 vs @v3.1.2)
- Detects secrets passed via env: and plaintext credentials in workflow files
- Checks for pull_request_target and overly broad permissions
- Returns a CI hardening checklist with file-level findings

## Quick start

```bash
skills run github-actions-security --checklist
skills run github-actions-security path=. --json
```

## Quick start

```bash
skills run github-actions-security --checklist
skills run github-actions-security path=. --json
```

## Usage

```bash
skills run github-actions-security --help
```

```bash
skills run github-actions-security <args>
```

## Options

| Option | Description |
|--------|-------------|
| `--help` | Show usage |
| `--json` | Machine-readable output |

## Requirements

- **Platform:** Windows 10/11 (primary target)
- Bun: `powershell -c "irm bun.sh/install.ps1 | iex"`
- Agents: Cursor, Claude Code, Copilot on Windows
- No API keys required
