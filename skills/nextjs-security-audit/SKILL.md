---
name: nextjs-security-audit
description: Security review for Next. Windows / PowerShell / cmd. Tags: nextjs, react, security. Use when next.js security audit, nextjs headers, api route auth, middleware security review.
displayName: Nextjs Security Audit
category: Development Tools
tags: [nextjs, react, security, headers, middleware, app-router, audit, hardening]
---

# Nextjs Security Audit


## When users ask (skills.sh search)

- next.js security audit
- nextjs headers
- api route auth
- middleware security review
- next.js security headers

## What It Does

- Scans Next.js config, middleware, and API routes for security gaps
- Checks for missing security headers and exposed server-only env vars
- Flags unauthenticated API routes and unsafe rewrites
- Generates a pre-launch Next.js security report

## Quick start

```bash
skills run nextjs-security-audit --checklist
skills run nextjs-security-audit path=. --json
```

## Quick start

```bash
skills run nextjs-security-audit --checklist
skills run nextjs-security-audit path=. --json
```

## Usage

```bash
skills run nextjs-security-audit --help
```

```bash
skills run nextjs-security-audit <args>
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
