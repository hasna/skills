---
name: dockerfile-security-scan
description: Scan Dockerfiles for root user, secrets in layers, and container hardening issues. Windows / PowerShell / cmd. Tags: docker, dockerfile, security Use when dockerfile security, run as root docker, container hardening, docker best practices.
displayName: Dockerfile Security Scan
category: Development Tools
tags: [docker, dockerfile, security, container, devops, audit, hardening, developer-tools]
---

# Dockerfile Security Scan


## When users ask (skills.sh search)

- dockerfile security
- run as root docker
- container hardening
- docker best practices
- dockerfile best practices


## What It Does

- Scans Dockerfiles for USER root, secrets in ENV/ARG, and latest tags
- Flags missing HEALTHCHECK and COPY of .env patterns
- Checks for curl|wget in RUN layers (supply-chain risk)
- Outputs container hardening checklist

## Quick start

```bash
skills run dockerfile-security-scan --checklist
skills run dockerfile-security-scan path=. --json
```

## Usage

```bash
skills run dockerfile-security-scan --help
```

```bash
skills run dockerfile-security-scan <args>
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
