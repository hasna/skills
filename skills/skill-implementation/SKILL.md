---
name: skill-implementation
description: Creates .implementation scaffold for project development tracking. Run at the start of any project to set up structured folders for plans, todos, audits, architecture, and documentation.
---

# Implementation Scaffold Skill

Creates a `.implementation` directory structure for tracking project development. Run `skill-implementation` at the beginning of any project.

## Quick Start

```bash
# Install globally
bun add -g skill-implementation

# Create scaffold
skill-implementation
```

## What Gets Created

```
.implementation/
├── data/
│   ├── indexes/
│   │   ├── TODOS.md      # Task index
│   │   ├── MEMENTOS.md   # Important notes and decisions
│   │   ├── PLANS.md      # Plans index
│   │   └── AUDITS.md     # Audits index
│   ├── plans/            # Implementation plans
│   ├── todos/            # Task lists
│   ├── audits/           # Audit records
│   └── architecture/     # Architecture docs
├── docs/                 # Documentation
├── logs/                 # Dev logs
└── README.md
```

## Usage

```bash
skill-implementation [options]

Options:
  --output <dir>   Output directory (default: current)
  --force          Overwrite existing scaffold
  --help           Show help
```

## Workflow

1. Run `skill-implementation` at project start
2. Add plans to `data/plans/` and index in `data/indexes/PLANS.md`
3. Track tasks in `data/todos/` and index in `data/indexes/TODOS.md`
4. Record decisions in `data/indexes/MEMENTOS.md`
5. Store audits in `data/audits/` and index in `data/indexes/AUDITS.md`
6. Keep architecture docs in `data/architecture/`
