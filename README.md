# @hasna/skills

Open source skill library for AI coding agents. 202 pre-built skills across 17 categories -- search, install, and run any skill with a single command.

```bash
npx @hasna/skills
```

## Features

- **202 ready-to-use skills** across development, business, content, data, media, design, and more
- **Interactive TUI** -- browse by category, search, and install from the terminal
- **MCP server** -- 9 tools and 2 resources for AI agent integration
- **HTTP dashboard** -- React web UI to browse, search, install, and manage skills
- **Agent-aware installs** -- copies SKILL.md to `~/.claude/skills/`, `~/.codex/skills/`, or `~/.gemini/skills/`
- **Auto-generated index** -- `.skills/index.ts` is updated on every install for easy imports
- **Library exports** -- use the registry, installer, and skill info programmatically

## Installation

```bash
# Global install (recommended)
bun install -g @hasna/skills

# Or use npx (no install needed)
npx @hasna/skills

# Or install as a project dependency
bun add @hasna/skills
```

## Quick Start

```bash
# Launch interactive browser (TUI)
skills

# Search for skills
skills search "image generation"

# Install skills to .skills/ in your project
skills install image deep-research generate-pdf

# Install a skill for Claude Code (copies SKILL.md)
skills install image --for claude

# Get skill details
skills info image

# Run a skill directly
skills run image --prompt "a sunset over mountains"

# Start the web dashboard
skills serve
```

## Categories

| Category | Count | Examples |
|----------|------:|---------|
| Development Tools | 32 | api-test-suite, deploy, mcp-builder, scaffold-project |
| Business & Marketing | 25 | email-campaign, salescopy, seo-brief-builder, persona-generator |
| Finance & Compliance | 16 | invoice, extract-invoice, budget-variance-analyzer |
| Content Generation | 14 | image, video, audio, generate-pdf, generate-presentation |
| Media Processing | 13 | subtitle, transcript, compress-video, remove-background |
| Data & Analysis | 12 | analyze-data, extract, dashboard-builder, generate-chart |
| Productivity & Organization | 11 | convert, merge-pdfs, file-organizer, notion-manager |
| Design & Branding | 11 | brand-style-guide, generate-favicon, product-mockup |
| Research & Writing | 10 | deepresearch, write, create-blog-article, create-ebook |
| Science & Academic | 10 | advanced-math, chemistry-calculator, citation-formatter |
| Education & Learning | 10 | study-guide-builder, lesson-plan-customizer, exam-readiness-check |
| Project Management | 9 | implementation, implementation-plan, action-item-router |
| Health & Wellness | 8 | meal-plan-designer, workout-cycle-planner, habit-reflection-digest |
| Travel & Lifestyle | 7 | itinerary-architect, destination-briefing, travel-budget-balancer |
| Communication | 4 | gmail, slack-assistant, sms, calendar-events |
| Web & Browser | 4 | browse, webcrawling, domainsearch, domainpurchase |
| Event Management | 4 | seating-chart-maker, livestream-runofshow, onsite-ops-checklist |

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `skills` | `skills i` | Interactive TUI browser (default) |
| `skills install <names...>` | `skills add` | Install one or more skills to `.skills/` |
| `skills install <name> --for <agent>` | | Install SKILL.md for claude, codex, gemini, or all |
| `skills remove <name>` | `skills rm` | Remove an installed skill |
| `skills list` | `skills ls` | List all available skills |
| `skills list --category <cat>` | | List skills in a category |
| `skills list --installed` | | List installed skills |
| `skills search <query>` | | Search skills by name, description, or tags |
| `skills info <name>` | | Show skill metadata, requirements, and env vars |
| `skills docs <name>` | | Show skill documentation (SKILL.md/README.md/CLAUDE.md) |
| `skills requires <name>` | | Show env vars, system deps, and npm dependencies |
| `skills run <name> [args...]` | | Run a skill directly |
| `skills categories` | | List all categories with counts |
| `skills init` | | Generate `.env.example` and update `.gitignore` |
| `skills update [names...]` | | Update installed skills (reinstall with overwrite) |
| `skills serve` | | Start the HTTP dashboard (default port 3579) |
| `skills mcp` | | Start the MCP server on stdio |
| `skills mcp --register <agent>` | | Register MCP server with claude, codex, gemini, or all |
| `skills self-update` | | Update `@hasna/skills` to the latest version |

All list/search/info commands support `--json` for machine-readable output.

## MCP Server

The MCP server exposes the full skill library to AI agents over stdio.

### Starting the server

```bash
# Via CLI
skills mcp

# Direct binary
skills-mcp

# Register with Claude Code
skills mcp --register claude
```

### Configuration for Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "skills": {
      "command": "skills-mcp"
    }
  }
}
```

### Tools (9)

| Tool | Description |
|------|-------------|
| `list_skills` | List all skills, optionally filtered by category |
| `search_skills` | Search skills by query (name, description, tags) |
| `get_skill_info` | Get skill metadata including requirements and env vars |
| `get_skill_docs` | Get documentation (SKILL.md, README.md, or CLAUDE.md) |
| `install_skill` | Install a skill (full source to `.skills/` or SKILL.md to agent dir) |
| `remove_skill` | Remove an installed skill |
| `list_categories` | List all categories with skill counts |
| `get_requirements` | Get env vars, system deps, and npm dependencies |
| `run_skill` | Run a skill by name with optional arguments |

### Resources (2)

| URI | Description |
|-----|-------------|
| `skills://registry` | Full skill registry as JSON |
| `skills://{name}` | Individual skill metadata and documentation |

## HTTP Dashboard

A React web UI for browsing, searching, and managing skills.

```bash
# Start the dashboard
skills serve

# Custom port
skills serve --port 8080

# Don't auto-open browser
skills serve --no-open
```

The dashboard runs at `http://localhost:3579` and provides:

- Searchable, sortable skills table with category filters
- Skill detail dialog with documentation, tags, and requirements
- One-click install and remove
- Dark/light/system theme toggle
- Self-update button

### REST API

The dashboard server also exposes a REST API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/skills` | GET | All skills with install status |
| `/api/categories` | GET | Categories with counts |
| `/api/skills/search?q=` | GET | Search skills |
| `/api/skills/:name` | GET | Single skill detail with docs |
| `/api/skills/:name/docs` | GET | Raw documentation text |
| `/api/skills/:name/install` | POST | Install a skill |
| `/api/skills/:name/remove` | POST | Remove a skill |
| `/api/version` | GET | Current package version |
| `/api/self-update` | POST | Update to latest version |

## Library Usage

Use the registry, installer, and skill info modules programmatically:

```typescript
import {
  SKILLS,
  CATEGORIES,
  searchSkills,
  getSkill,
  getSkillsByCategory,
} from "@hasna/skills";

// Search skills
const results = searchSkills("image");

// Get skills in a category
const devTools = getSkillsByCategory("Development Tools");

// Get a specific skill
const skill = getSkill("image");
// => { name: "image", displayName: "Image", description: "...", category: "Content Generation", tags: [...] }
```

```typescript
import {
  installSkill,
  installSkillForAgent,
  removeSkill,
  getInstalledSkills,
} from "@hasna/skills";

// Install a skill to .skills/
const result = installSkill("image");
// => { skill: "image", success: true, path: "/path/to/.skills/skill-image" }

// Install SKILL.md for Claude Code
installSkillForAgent("image", { agent: "claude", scope: "global" });

// List installed skills
const installed = getInstalledSkills();
// => ["image", "deep-research"]
```

```typescript
import {
  getSkillDocs,
  getSkillRequirements,
  runSkill,
} from "@hasna/skills";

// Read documentation
const docs = getSkillDocs("image");
// => { skillMd: "...", readme: "...", claudeMd: "..." }

// Check requirements
const reqs = getSkillRequirements("image");
// => { envVars: ["OPENAI_API_KEY"], systemDeps: [], cliCommand: "image", dependencies: {...} }

// Run a skill
const { exitCode } = await runSkill("image", ["--prompt", "a cat"]);
```

## Skill Structure

Each skill is a self-contained directory under `skills/skill-{name}/`:

```
skills/skill-{name}/
├── src/
│   ├── index.ts          # Main entry point / programmatic API
│   ├── commands/          # CLI command handlers (optional)
│   ├── lib/               # Core logic
│   ├── types/             # TypeScript types
│   └── utils/             # Utility functions
├── SKILL.md               # Skill definition (used by agent installs)
├── README.md              # Usage documentation
├── CLAUDE.md              # Development guide (optional)
├── package.json           # Dependencies and bin entry
└── tsconfig.json          # Extends skills/tsconfig.base.json
```

Key files:

- **SKILL.md** -- the primary doc file, copied to agent skill directories on `--for` installs. Contains frontmatter (name, description) and usage instructions.
- **package.json** -- must have a `bin` entry for the skill to be runnable via `skills run`.
- **src/index.ts** -- exported in the auto-generated `.skills/index.ts` when installed.

## Using Installed Skills

After installing, skills are available via the auto-generated index:

```typescript
import { image, deep_research } from "./.skills";
```

Or import directly:

```typescript
import { generateImage } from "./.skills/skill-image/src/index.js";
```

## Creating a Custom Skill

1. Create the skill directory:

```bash
mkdir -p skills/skill-my-skill/src
```

2. Add `package.json`:

```json
{
  "name": "@hasna/skill-my-skill",
  "version": "0.0.1",
  "bin": { "my-skill": "./src/index.ts" },
  "dependencies": {}
}
```

3. Add `SKILL.md` with frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# My Skill

Usage instructions here.
```

4. Add `src/index.ts` with your logic.

5. Register in `src/lib/registry.ts`:

```typescript
{
  name: "my-skill",
  displayName: "My Skill",
  description: "What this skill does",
  category: "Development Tools",
  tags: ["my", "skill"],
}
```

6. Run tests to validate:

```bash
bun test
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in dev mode
bun run dev

# Build CLI, MCP server, and library
bun run build

# Type check
bun run typecheck

# Run all tests
bun test

# Build the dashboard
bun run dashboard:build

# Run dashboard dev server
bun run dashboard:dev

# Start HTTP server (with dashboard)
bun run server:dev
```

## Architecture

```
src/
├── cli/
│   ├── index.tsx              # Commander.js CLI + Ink TUI
│   ├── cli.test.ts            # CLI integration tests
│   └── components/
│       └── App.tsx            # Interactive TUI (React/Ink)
├── mcp/
│   ├── index.ts               # MCP server (stdio transport)
│   └── mcp.test.ts            # MCP integration tests
├── server/
│   ├── serve.ts               # Bun HTTP server + REST API
│   └── serve.test.ts          # Server tests
├── lib/
│   ├── registry.ts            # SKILLS array (202) + CATEGORIES (17)
│   ├── installer.ts           # Install/remove to .skills/ and agent dirs
│   ├── skillinfo.ts           # Docs, requirements, env vars, run
│   ├── utils.ts               # normalizeSkillName()
│   ├── registry.test.ts       # Registry tests
│   ├── installer.test.ts      # Installer tests
│   ├── skillinfo.test.ts      # Skill info tests
│   ├── skillinfo-run.test.ts  # Skill run tests
│   ├── utils.test.ts          # Utils tests
│   └── validation.test.ts     # Structural validation (all 202 skills)
├── index.ts                   # Library re-exports
└── index.test.ts              # Library export tests

dashboard/                     # Vite + React 19 + Tailwind v4 + shadcn/ui
├── src/components/
│   ├── skills-table.tsx       # Main skills table (TanStack Table)
│   ├── skill-detail-dialog.tsx# Skill detail dialog
│   ├── stats-cards.tsx        # Summary cards
│   ├── theme-provider.tsx     # Dark/light/system theme
│   ├── theme-toggle.tsx       # Theme toggle button
│   └── ui/                    # shadcn/ui primitives
└── package.json

skills/                        # 202 self-contained skill directories
├── _common/                   # Shared utilities
├── skill-image/
├── skill-deep-research/
├── ...
└── tsconfig.base.json         # Shared TS config for skills
```

## License

Apache-2.0
