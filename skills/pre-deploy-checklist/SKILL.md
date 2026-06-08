---
name: pre-deploy-checklist
description: Pre-deployment checklist for tests, security, env vars, migrations, and rollback readiness. Windows / PowerShell / cmd. Tags: deploy, checklist, release. Use when ready to deploy, production checklist, go live review, release readiness.
displayName: Pre Deploy Checklist
category: Development Tools
tags: [deploy, checklist, release, production, security, audit, hardening, developer-tools]
---

# Pre Deploy Checklist


## When users ask (skills.sh search)

- ready to deploy
- production checklist
- go live review
- release readiness
- production release checklist

## What It Does

- Runs a production readiness scan: tests, env, migrations, rollback
- Checks for .env.example, CI config, and lockfile presence
- Flags debug flags, TODO markers, and missing build scripts
- Returns go-live checklist with pass/warn/fail items

## Quick start

```bash
skills run pre-deploy-checklist --checklist
skills run pre-deploy-checklist path=. --json
```

## Quick start

```bash
skills run pre-deploy-checklist --checklist
skills run pre-deploy-checklist path=. --json
```

## Usage

```bash
skills run pre-deploy-checklist --help
```

```bash
skills run pre-deploy-checklist <args>
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
