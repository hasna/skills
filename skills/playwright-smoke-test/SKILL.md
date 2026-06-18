---
name: playwright-smoke-test
description: Generate Playwright smoke tests for critical user flows and CI pipelines. Windows / PowerShell / cmd. Tags: playwright, e2e, testing Use when playwright smoke test, e2e critical path, browser test ci, quick regression suite.
displayName: Playwright Smoke Test
category: Development Tools
tags: [playwright, e2e, testing, smoke, ci, browser, tdd, vitest]
---

# Playwright Smoke Test


## When users ask (skills.sh search)

- playwright smoke test
- e2e critical path
- browser test ci
- quick regression suite
- e2e critical paths


## What It Does

- Detects Playwright config and existing e2e test layout
- Suggests critical-path smoke scenarios from routes and package scripts
- Outputs starter spec outline for CI smoke suite
- No browser launch — planning scaffold only (offline)

## Quick start

```bash
skills run playwright-smoke-test --checklist
skills run playwright-smoke-test path=. --json
```

## Usage

```bash
skills run playwright-smoke-test --help
```

```bash
skills run playwright-smoke-test <args>
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
