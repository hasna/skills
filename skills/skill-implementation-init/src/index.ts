#!/usr/bin/env bun

import * as fs from "fs";
import * as path from "path";
import minimist from "minimist";

// Parse command line arguments
const args = minimist(process.argv.slice(2), {
  string: ["name"],
  boolean: ["force", "no-indexes", "help"],
  default: {
    force: false,
    "no-indexes": false,
  },
  alias: {
    n: "name",
    f: "force",
    h: "help",
  },
});

// Show help
if (args.help) {
  console.log(`
Implementation Init - Initialize .implementation folder structure

Usage:
  skills run implementation-init -- [directory] [options]

Options:
  -n, --name <name>   Project name to include in index files
  -f, --force         Overwrite existing .implementation folder
  --no-indexes        Skip creating index files
  -h, --help          Show this help

Examples:
  skills run implementation-init
  skills run implementation-init -- /path/to/project
  skills run implementation-init -- . --name "My Project"
  skills run implementation-init -- . --force
`);
  process.exit(0);
}

// Get target directory
// Priority: 1. User-provided argument, 2. SKILLS_CWD env var (user's working dir), 3. process.cwd()
const targetDir = args._[0] as string || process.env.SKILLS_CWD || process.cwd();
const resolvedDir = path.resolve(targetDir);

if (!fs.existsSync(resolvedDir)) {
  console.error(`Error: Directory not found: ${resolvedDir}`);
  process.exit(1);
}

if (!fs.statSync(resolvedDir).isDirectory()) {
  console.error(`Error: Not a directory: ${resolvedDir}`);
  process.exit(1);
}

const implDir = path.join(resolvedDir, ".implementation");

// Check if already exists
if (fs.existsSync(implDir) && !args.force) {
  console.error(`Error: .implementation folder already exists at ${implDir}`);
  console.error("Use --force to overwrite");
  process.exit(1);
}

// Directory structure to create
const directories = [
  "data/indexes",
  "data/todos/json",
  "data/todos/md",
  "data/plans",
  "data/audits",
  "data/architecture",
  "data/mementos",
  "data/agents",
  "data/hooks",
  "data/costs",
  "scripts",
  "logs",
  "docs",
];

// Index file contents
const projectName = args.name || path.basename(resolvedDir);
const timestamp = new Date().toISOString().split("T")[0];

const indexFiles: Record<string, string> = {
  "data/indexes/TODOS.md": `# Todos Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all todo items in this implementation.

## Active Todos

| ID | File | Title | Status | Priority |
|----|------|-------|--------|----------|
| - | - | No todos yet | - | - |

## Completed Todos

| ID | File | Title | Completed |
|----|------|-------|-----------|
| - | - | No completed todos | - |

---

*Updated automatically by implementation-todo skill*
`,

  "data/indexes/PLANS.md": `# Plans Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all implementation plans.

## Active Plans

| ID | File | Title | Status | Created |
|----|------|-------|--------|---------|
| - | - | No plans yet | - | - |

## Completed Plans

| ID | File | Title | Completed |
|----|------|-------|-----------|
| - | - | No completed plans | - |

---

*Updated automatically by implementation-plan skill*
`,

  "data/indexes/AUDITS.md": `# Audits Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all code audits.

## Recent Audits

| ID | File | Scope | Date | Findings |
|----|------|-------|------|----------|
| - | - | No audits yet | - | - |

---

*Add audit reports to data/audits/*
`,

  "data/indexes/ARCHITECTURE.md": `# Architecture Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all architecture decision records (ADRs).

## Decisions

| ID | File | Title | Status | Date |
|----|------|-------|--------|------|
| - | - | No ADRs yet | - | - |

---

*Add architecture decision records to data/architecture/*
`,

  "data/indexes/MEMENTOS.md": `# Mementos Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all mementos - notes, context, decisions, and discoveries.

## Recent Mementos

| ID | Slug | Title | Category | Created |
|----|------|-------|----------|---------|
| - | - | No mementos yet | - | - |

---

*Updated automatically by implementation-memento skill*
`,

  "data/indexes/AGENTS.md": `# Agents Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all Claude Code agent definitions.

## Agents

| ID | File | Name | Slug | Global | Created |
|----|------|------|------|--------|---------|
| - | - | No agents yet | - | - | - |

---

*Updated automatically by implementation-agent skill*
`,

  "data/indexes/HOOKS.md": `# Hooks Index

Project: ${projectName}
Created: ${timestamp}

## Overview

This file indexes all Claude Code hook configurations.

## Hooks

| ID | File | Name | Event | Matcher | Type | Created |
|----|------|------|-------|---------|------|---------|
| - | - | No hooks yet | - | - | - | - |

---

*Updated automatically by implementation-hook skill*
`,

  "data/indexes/COSTS.md": `# Costs Dashboard

**Project:** ${projectName}
**Updated:** ${timestamp}
**Total Cost:** $0.00

## Summary

| Metric | Value |
|--------|-------|
| Sessions | 0 |
| Total Tokens | 0 |
| Total Cost | $0.00 |
| Avg Cost/Session | $0.00 |

## Token Breakdown

| Type | Tokens | Cost |
|------|--------|------|
| Input | 0 | $0.00 |
| Output | 0 | $0.00 |
| Cache Write | 0 | $0.00 |
| Cache Read | 0 | $0.00 |
| **Total** | **0** | **$0.00** |

## Recent Sessions

| ID | Session | Date | Duration | Tokens | Cost |
|----|---------|------|----------|--------|------|
| - | No sessions yet | - | - | - | - |

---

*Run 'implementation-cost' to track Claude Code session costs*
`,
};

// Main execution
async function main(): Promise<void> {
  console.log(`\nImplementation Init`);
  console.log(`===================\n`);
  console.log(`Target: ${resolvedDir}`);
  console.log(`Project: ${projectName}\n`);

  // Remove existing if force
  if (fs.existsSync(implDir) && args.force) {
    console.log(`Removing existing .implementation folder...`);
    fs.rmSync(implDir, { recursive: true });
  }

  // Create directories
  console.log(`Creating directories...`);
  for (const dir of directories) {
    const fullPath = path.join(implDir, dir);
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`  Created: .implementation/${dir}/`);
  }

  // Create index files
  if (!args["no-indexes"]) {
    console.log(`\nCreating index files...`);
    for (const [filePath, content] of Object.entries(indexFiles)) {
      const fullPath = path.join(implDir, filePath);
      fs.writeFileSync(fullPath, content);
      console.log(`  Created: .implementation/${filePath}`);
    }
  }

  // Create .gitkeep files for empty directories
  const gitkeepDirs = [
    "data/todos/json",
    "data/todos/md",
    "data/plans",
    "data/audits",
    "data/architecture",
    "data/mementos",
    "data/agents",
    "data/hooks",
    "data/costs",
    "scripts",
    "logs",
    "docs",
  ];

  for (const dir of gitkeepDirs) {
    const gitkeepPath = path.join(implDir, dir, ".gitkeep");
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, "");
    }
  }

  // Summary
  console.log(`\n${"=".repeat(40)}`);
  console.log(`\nInitialization complete!`);
  console.log(`\nCreated structure:`);
  console.log(`
.implementation/
├── data/
│   ├── indexes/
│   │   ├── TODOS.md
│   │   ├── PLANS.md
│   │   ├── AUDITS.md
│   │   ├── ARCHITECTURE.md
│   │   ├── MEMENTOS.md
│   │   ├── AGENTS.md
│   │   ├── HOOKS.md
│   │   └── COSTS.md
│   ├── todos/
│   │   ├── json/
│   │   └── md/
│   ├── plans/
│   ├── audits/
│   ├── architecture/
│   ├── mementos/
│   ├── agents/
│   ├── hooks/
│   └── costs/
├── scripts/
├── logs/
└── docs/
`);

  console.log(`\nNext steps:`);
  console.log(`  - Use 'implementation-todo' to create todo items`);
  console.log(`  - Use 'implementation-plan' to create implementation plans`);
  console.log(`  - Use 'implementation-agent' to create Claude Code agents`);
  console.log(`  - Use 'implementation-hook' to create Claude Code hooks`);
  console.log(`  - Use 'implementation-cost' to track Claude Code session costs`);
  console.log(`  - Add architecture decisions to data/architecture/`);
  console.log(`  - Add audit reports to data/audits/`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
