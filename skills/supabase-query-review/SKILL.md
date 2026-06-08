---
name: supabase-query-review
description: Review Supabase queries, RLS policies, and Postgres access patterns for security issues. Windows / PowerShell / cmd. Tags: supabase, postgres, sql. Use when supabase rls, postgres security review, sql injection supabase, row level security audit.
displayName: Supabase Query Review
category: Development Tools
tags: [supabase, postgres, sql, security, rls, database, audit, hardening]
---

# Supabase Query Review


## When users ask (skills.sh search)

- supabase rls
- postgres security review
- sql injection supabase
- row level security audit
- supabase rls policy

## What It Does

- Reviews SQL migrations and Supabase client code for missing RLS policies
- Flags service_role usage in client bundles and unsafe raw SQL patterns
- Checks for auth.uid() gaps and public table exposure risks
- Outputs Postgres/Supabase security checklist for agents

## Quick start

```bash
skills run supabase-query-review --checklist
skills run supabase-query-review path=. --json
```

## Quick start

```bash
skills run supabase-query-review --checklist
skills run supabase-query-review path=. --json
```

## Usage

```bash
skills run supabase-query-review --help
```

```bash
skills run supabase-query-review <args>
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
