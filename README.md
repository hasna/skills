# @hasna/skills

Skills library for AI coding agents — discover, install, and run reusable capabilities for Claude Code, Codex CLI, Gemini CLI, and more.

[![npm](https://img.shields.io/npm/v/@hasna/skills)](https://www.npmjs.com/package/@hasna/skills)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/skills
```

Requires [Bun](https://bun.sh/) 1.0+.

## Quick Start

```bash
# Browse skills interactively
skills

# Install a skill to your project
skills install image

# Install for a specific agent
skills install image --for claude

# See what a skill needs
skills info image

# Run a skill
skills run image "a cat sitting on a windowsill"
```

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `skills` | | Interactive TUI to browse, search, and install skills |
| `skills install <name>` | `add` | Install one or more skills to `.skills/` |
| `skills install --for claude` | | Copy SKILL.md to `~/.claude/skills/` (also `codex`, `gemini`, `pi`, `opencode`, `all`) |
| `skills install --category "Development Tools"` | | Install all skills in a category |
| `skills list` | `ls` | List available skills (filter with `-c`, `-i`, `-t`, `--brief`) |
| `skills search <query>` | `s` | Search by name, description, or tags |
| `skills info <name>` | | Show metadata, env vars, and system dependencies |
| `skills docs <name>` | | Show documentation (SKILL.md > README.md > CLAUDE.md) |
| `skills requires <name>` | | Show env vars, system deps, and npm dependencies |
| `skills run <name> [args]` | | Execute a skill directly |
| `skills remove <name>` | `rm` | Remove an installed skill |
| `skills update` | | Reinstall all skills with `--overwrite` (version diff shown) |
| `skills diff <name>` | | Preview file changes before updating a skill |
| `skills init` | | Generate `.env.example` and update `.gitignore` for installed skills |
| `skills categories` | | List all categories with skill counts |
| `skills tags` | | List all unique tags with occurrence counts |
| `skills doctor` | | Check env vars, system deps, and install health |
| `skills test [name]` | | Test skill readiness (env, system, npm deps) |
| `skills outdated` | | Compare installed vs registry versions |
| `skills auth [name]` | | Show/set auth env vars in `.env` |
| `skills whoami` | | Version, installed skills, agent configs, paths |
| `skills export` | | Export installed skills as JSON |
| `skills import <file>` | | Install skills from a JSON export |
| `skills config set <key> <value>` | | Set default agent, scope, or output format |
| `skills create <name>` | | Scaffold a new custom skill directory |
| `skills sync --to claude` | | Push custom skills to agent directories |
| `skills sync --from claude` | | List agent skills, `--register` to import unknown ones |
| `skills validate <name>` | | Check a skill's directory structure |
| `skills schedule add <skill> <cron>` | | Set up recurring skill execution |
| `skills schedule list` | | List all schedules (enabled/disabled/last run) |
| `skills mcp` | | Start MCP server on stdio |
| `skills mcp --register claude` | | Auto-register MCP server with an agent |
| `skills serve` | | Start the HTTP dashboard on localhost |
| `skills self-update` | | Update this package to the latest version |
| `skills completion <shell>` | | Generate shell completions (bash, zsh, fish) |

### Common Options

- `--json` — Output as JSON (pipeable)
- `--brief` — One-line format
- `--dry-run` — Preview without applying changes
- `--verbose` — Debug logging to stderr
- `--no-color` — Disable ANSI colors
- `-o, --overwrite` — Overwrite existing files during install

## MCP Server

```bash
skills mcp    # stdio transport (use with Claude/Codex MCP config)
```

The MCP server exposes 20+ tools including `list_skills`, `search_skills`, `install_skill`, `get_skill_info`, `get_skill_docs`, `get_requirements`, `run_skill`, `schedule_skill`, `detect_project_skills`, `validate_skill`, and more.

### Register with an Agent

```bash
skills mcp --register claude    # Auto-register with Claude Code
skills mcp --register all       # Register with all supported agents
```

## Cloud Sync

```bash
cloud setup
cloud sync push --service skills
cloud sync pull --service skills
```

## Dashboard

```bash
skills serve              # Start HTTP server (opens browser automatically)
skills serve --no-open    # Start without opening the browser
```

Dashboard features: searchable/filterable skills table, detail dialogs, stats cards, dark/light/system theme, oklch color tokens.

## Project Structure

```
src/
├── cli/index.tsx           # Commander.js CLI + Ink TUI
├── mcp/index.ts            # MCP server (stdio) with ~20 tools
├── server/serve.ts          # Bun.serve HTTP server + REST API
├── lib/
│   ├── registry.ts          # 202+ entries, search, categories, tags
│   ├── installer.ts         # Copy skills to .skills/ or agent dirs
│   ├── skillinfo.ts         # Docs, requirements, env/system detection
│   ├── scheduler.ts         # Cron-based skill execution
│   ├── config.ts            # Global + project config loading
│   └── utils.ts             # normalizeSkillName()
├── index.ts                 # Library re-exports (npm package entry)
└── *.test.ts                # Test files

skills/                      # 202+ skill directories
├── _common/                 # Shared utilities
└── skill-*/                 # Each skill: src/, SKILL.md, package.json

dashboard/                   # Vite + React 19 + Tailwind v4 SPA
```

## Installation Types

1. **Full source** — copies skill to `.skills/` in your project (default)
2. **Agent config** — copies only SKILL.md to `~/.{agent}/skills/` (use `--for`)
3. **Global custom** — create with `skills create --global` (stores in `~/.hasna/skills/custom/`)

## Development

```bash
bun install
bun run build              # Build CLI, MCP, library, and types
bun run dev                # Run CLI in dev mode (no build needed)
bun run dashboard:dev       # Vite dev server for web dashboard
bun run server:dev          # HTTP server with --watch
bun test                   # Run all tests
bun run typecheck          # TypeScript type checking
```

## Adding a New Skill

1. Create `skills/skill-{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, `SKILL.md`
2. Add an entry to the `SKILLS` array in `src/lib/registry.ts`
3. Run `bun test` to verify validation passes

Skill directories are auto-discovered from `~/.hasna/skills/custom/` and `.skills/custom-skills/` — no registry entry needed for local custom skills.

## Data Directory

Configuration and runtime data are stored in `~/.hasna/skills/`. Legacy `~/.skillsrc` is auto-migrated on first run.

## License

Apache-2.0 — see [LICENSE](LICENSE)
