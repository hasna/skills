---
name: tdd-workflow
description: Test-driven development workflow with red-green-refactor steps for new features. Windows / PowerShell / cmd. Tags: tdd, testing, jest Use when test driven development, write tests first, red green refactor, tdd steps.
displayName: Tdd Workflow
category: Development Tools
tags: [tdd, testing, jest, vitest, workflow, developer-tools, cli, windows]
---

# Tdd Workflow


## When users ask (skills.sh search)

- test driven development
- write tests first
- red green refactor
- tdd steps
- Windows PowerShell security


## What It Does

- Outlines red-green-refactor workflow steps for the current change
- Suggests first failing test cases from feature description
- Maps test file locations to src/ modules
- Outputs TDD session plan as structured JSON

## Quick start

```bash
skills run tdd-workflow --checklist
skills run tdd-workflow path=. --json
```

## Usage

```bash
skills run tdd-workflow --help
```

```bash
skills run tdd-workflow <args>
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
