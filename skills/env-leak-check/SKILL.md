---
name: env-leak-check
description: Find committed. Windows / PowerShell / cmd. Tags: security, env, secrets. Use when .env committed to git, dotenv leak, secrets in repo, environment variable audit.
displayName: Env Leak Check
category: Development Tools
tags: [security, env, secrets, dotenv, audit, hardening, environment, credentials]
---

# Env Leak Check


## When users ask (skills.sh search)

- .env committed to git
- dotenv leak
- secrets in repo
- environment variable audit
- committed .env file

## What It Does

- Finds .env, .env.local, and .env.production files in the project tree
- Scans source files for hardcoded API keys, tokens, and password patterns
- Flags unsafe NEXT_PUBLIC_/VITE_ exposure of secrets
- Produces a leak report suitable for pre-commit review

## Quick start

```bash
skills run env-leak-check --checklist
skills run env-leak-check path=. --json
```

## Quick start

```bash
skills run env-leak-check --checklist
skills run env-leak-check path=. --json
```

## Usage

```bash
skills run env-leak-check --help
```

```bash
skills run env-leak-check <args>
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
