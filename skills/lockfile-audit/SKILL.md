---
name: lockfile-audit
description: Validate lockfiles, detect missing pins, and flag risky dependency patterns. Windows / PowerShell / cmd. Tags: security, lockfile, npm. Use when audit package-lock.json, bun.lock security, pnpm lockfile review, unpinned dependencies.
displayName: Lockfile Audit
category: Development Tools
tags: [security, lockfile, npm, dependencies, audit, hardening, package-lock, developer-tools]
---

# Lockfile Audit


## When users ask (skills.sh search)

- audit package-lock.json
- bun.lock security
- pnpm lockfile review
- unpinned dependencies
- check bun.lock for security

## What It Does

- Scans package-lock.json, yarn.lock, pnpm-lock.yaml, and bun.lock for integrity fields
- Flags unpinned semver ranges (^ / ~) on production dependencies
- Reports missing lockfiles when package.json declares dependencies
- Outputs structured JSON for CI gates and agent review

## Quick start

```bash
skills run lockfile-audit --checklist
skills run lockfile-audit path=. --json
```

## Quick start

```bash
skills run lockfile-audit --checklist
skills run lockfile-audit path=. --json
```

## Usage

```bash
skills run lockfile-audit --help
```

```bash
skills run lockfile-audit <args>
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
