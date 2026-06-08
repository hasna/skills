---
name: react-server-actions-audit
description: Audit React Server Actions and RSC data flows for auth leaks and unsafe mutations. Windows / PowerShell / cmd. Tags: react, server-actions, rsc. Use when react server actions security, rsc data leak, server actions auth, use server audit.
displayName: React Server Actions Audit
category: Development Tools
tags: [react, server-actions, rsc, security, nextjs, audit, hardening, app-router]
---

# React Server Actions Audit


## When users ask (skills.sh search)

- react server actions security
- rsc data leak
- server actions auth
- use server audit
- rsc data exposure

## What It Does

- Finds 'use server' actions and reviews auth boundary patterns
- Flags client-imported server modules and sensitive data in RSC props
- Checks for missing input validation on server actions
- Outputs RSC/Server Actions security checklist

## Quick start

```bash
skills run react-server-actions-audit --checklist
skills run react-server-actions-audit path=. --json
```

## Quick start

```bash
skills run react-server-actions-audit --checklist
skills run react-server-actions-audit path=. --json
```

## Usage

```bash
skills run react-server-actions-audit --help
```

```bash
skills run react-server-actions-audit <args>
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
