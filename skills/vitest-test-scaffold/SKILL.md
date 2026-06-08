---
name: vitest-test-scaffold
description: Scaffold Vitest unit tests, config, and first test files for TypeScript projects. Windows / PowerShell / cmd. Tags: vitest, testing, jest. Use when set up vitest, vitest config, unit test scaffold, write vitest tests.
displayName: Vitest Test Scaffold
category: Development Tools
tags: [vitest, testing, jest, unit-test, tdd, developer-tools, cli, windows]
---

# Vitest Test Scaffold


## When users ask (skills.sh search)

- set up vitest
- vitest config
- unit test scaffold
- write vitest tests
- write first tests

## What It Does

- Detects existing test setup (vitest/jest) and project TypeScript layout
- Suggests vitest.config.ts, setup files, and first unit test templates
- Lists recommended test targets from src/ structure
- Outputs scaffold plan as JSON for agent-driven test generation

## Quick start

```bash
skills run vitest-test-scaffold --checklist
skills run vitest-test-scaffold path=. --json
```

## Quick start

```bash
skills run vitest-test-scaffold --checklist
skills run vitest-test-scaffold path=. --json
```

## Usage

```bash
skills run vitest-test-scaffold --help
```

```bash
skills run vitest-test-scaffold <args>
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
