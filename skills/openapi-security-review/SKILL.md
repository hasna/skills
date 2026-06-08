---
name: openapi-security-review
description: Review OpenAPI specs for auth gaps, data exposure, and unsafe endpoint design. Windows / PowerShell / cmd. Tags: openapi, api, security Use when openapi security, swagger audit, rest api review, api auth design.
displayName: Openapi Security Review
category: Development Tools
tags: [openapi, api, security, swagger, rest, audit, hardening, developer-tools]
---

# Openapi Security Review


## When users ask (skills.sh search)

- openapi security
- swagger audit
- rest api review
- api auth design
- api spec audit


## What It Does

- Finds OpenAPI/Swagger specs and reviews auth scheme coverage
- Flags endpoints missing security requirements and sensitive field exposure
- Checks for overly permissive CORS and admin paths without auth
- Returns API security review report

## Quick start

```bash
skills run openapi-security-review --checklist
skills run openapi-security-review path=. --json
```

## Usage

```bash
skills run openapi-security-review --help
```

```bash
skills run openapi-security-review <args>
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
