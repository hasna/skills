# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun install                  # Install dependencies
bun run build                # Build CLI (bin/), MCP (bin/mcp.js), library (dist/), and type declarations
bun run dev                  # Run CLI in development mode
bun test                     # Run all tests (Bun native test runner)
bun test src/lib/registry    # Run a single test file
bun run typecheck            # Type-check without emitting (tsc --noEmit)
bun run dashboard:build      # Build dashboard (cd dashboard && bun install && bun run build)
bun run dashboard:dev        # Vite dev server for dashboard
bun run server               # Start dashboard HTTP server (port 3579)
bun run server:dev           # Start dashboard server with --watch
```

## Architecture

This is a monorepo containing 200 AI agent skills plus a framework for discovering, installing, and managing them. The framework exposes four interfaces:

**CLI (`src/cli/index.tsx`)** - Commander.js + Ink (React for terminal). Running `skills` with no args launches an interactive TUI (browse by category, search, select & install). Subcommands: `install`, `list`, `search`, `info`, `docs`, `requires`, `run`, `remove`, `update`, `categories`, `mcp`, `serve`.

**MCP Server (`src/mcp/index.ts`)** - Model Context Protocol server over stdio. Registers 9 tools (`list_skills`, `search_skills`, `get_skill_info`, `get_skill_docs`, `install_skill`, `remove_skill`, `list_categories`, `get_requirements`, `run_skill`) and 2 resources (`skills://registry`, `skills://{name}`).

**HTTP Dashboard (`src/server/serve.ts`)** - Bun.serve HTTP server that serves a Vite+React+Tailwind v4 SPA from `dashboard/dist/` and provides REST API routes (`GET /api/skills`, `GET /api/categories`, `GET /api/skills/search?q=`, `GET /api/skills/:name`, `GET /api/skills/:name/docs`, `POST /api/skills/:name/install`, `POST /api/skills/:name/remove`).

**Library (`src/index.ts`)** - npm package `@hasna/skills` re-exporting three core modules.

### Core Modules

- **`src/lib/registry.ts`** - The `SKILLS` array (200 entries) and `CATEGORIES` (17 categories). Each skill has: name, displayName, description, category, tags. Functions: `getSkill()`, `getSkillsByCategory()`, `searchSkills()`.

- **`src/lib/installer.ts`** - Copies skill source into `.skills/` in the user's project. Also supports agent-specific installs (copies SKILL.md to `~/.claude/skills/`, `~/.codex/skills/`, or `~/.gemini/skills/`). Functions: `installSkill()`, `removeSkill()`, `getInstalledSkills()`, `installSkillForAgent()`.

- **`src/lib/skillinfo.ts`** - Reads docs (SKILL.md > README.md > CLAUDE.md priority), extracts env vars and system deps via regex, reads CLI command from package.json bin field, can execute skills via `runSkill()`.

- **`src/lib/utils.ts`** - `normalizeSkillName()` which prefixes `skill-` if missing.

### Dashboard (`dashboard/`)

Vite + React 19 + Tailwind v4 + shadcn/ui + TanStack Table. Separate `package.json` and `tsconfig.json`. Uses `@/` path alias. Components in `dashboard/src/components/` with shadcn primitives in `ui/` subfolder. Theme uses oklch color tokens with dark/light/system toggle (storage key: `skills-dashboard-theme`).

### Skills (`skills/`)

Each skill is a self-contained directory `skills/skill-{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, and documentation files. Skills extend from `skills/tsconfig.base.json`. Shared utilities live in `skills/_common/`.

## Key Patterns

- **ESM with .js extensions** - All imports use `.js` extensions even for `.ts` source files (e.g., `from "../lib/registry.js"`)
- **JSON imports** - Use `with { type: "json" }` syntax (e.g., `import pkg from "../../package.json" with { type: "json" }`)
- **Build produces 3 bundles** - CLI → `bin/index.js` (externals: ink, react, chalk), MCP → `bin/mcp.js`, Library → `dist/index.js`. Type declarations via `tsc --emitDeclarationOnly`.
- **Skill name normalization** - Registry uses bare names (`image`), filesystem uses prefixed names (`skill-image`). `normalizeSkillName()` handles conversion.
- **TTY detection** - CLI renders Ink TUI when `process.stdout.isTTY`, falls back to help text in non-interactive environments.
- **Skill name validation** - Server validates with `/^[a-z0-9-]+$/` to prevent path traversal.

## Adding a New Skill

1. Create `skills/skill-{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, `SKILL.md`
2. Add entry to the `SKILLS` array in `src/lib/registry.ts` with name, displayName, description, category (must be from `CATEGORIES`), and tags array
3. Run `bun test` to verify registry integrity

## Testing

Tests use `bun:test` with `describe`/`test`/`expect` pattern. CLI tests spawn `bun run src/cli/index.tsx` as subprocesses and check stdout. MCP tests use the SDK's in-memory transport. Set `NO_COLOR=1` in test environments for deterministic output.
