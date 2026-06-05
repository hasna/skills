# @hasna/skills

Skills library for AI coding agents — discover, pin, and run reusable capabilities through the Skills CLI and MCP server for Claude Code, Codex CLI, Gemini CLI, OpenCode, and more.

[![npm](https://img.shields.io/npm/v/@hasna/skills)](https://www.npmjs.com/package/@hasna/skills)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install The CLI

```bash
bun install -g @hasna/skills
```

Requires [Bun](https://bun.sh/) 1.0+.

## Quick Start

```bash
# Browse skills interactively
skills

# Hosted setup is the recommended interactive path
skills setup --mode hosted
skills auth login

# Local-only setup stays available and does not require an account
skills setup --mode local

# Optionally pin a skill preference in this project
skills pin image

# Register the Skills MCP server with every supported agent
skills setup agents

# See what a skill needs
skills info image

# Premium skills run through the configured hosted API
skills run image "a cat sitting on a windowsill"

# Free/local skills can still use your own provider keys when documented
skills requires brand-style-guide
OPENAI_API_KEY=... skills run brand-style-guide ./brand-notes.md
```

## Remote-Only Premium Skills

Premium skills are hosted SaaS runs. The CLI and MCP server submit them to the
configured hosted API, create local run metadata, and then expose status and
artifact commands. They do not fall back to bundled local execution when auth is
missing or the platform is unavailable.

Use `SKILLS_API_KEY` or `skills auth login` for premium hosted execution:

```bash
skills setup --mode hosted
skills auth login
skills run image "editorial product photo on a white sweep"
skills runs status <run-id>
skills exports download <run-id>
```

`skills auth login` uses browser/device-code auth by default. Email code login
is still available with `skills auth login --email you@example.com`.

`SKILLS_API_KEY` is the hosted account credential. It is not a provider
credential. Provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
`GEMINI_API_KEY` remain supported only for free/local OSS skills whose
requirements explicitly document local provider use.

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `skills` | | Interactive TUI to browse, search, and pin skills |
| `skills pin <name>` | | Pin one or more skills in `.skills/project.json`; no source is copied |
| `skills pin --category "Development Tools"` | | Pin all skills in a category |
| `skills unpin <name>` | | Remove a project pin |
| `skills pins list` | | List pinned skills |
| `skills setup --mode hosted` | | Configure hosted mode with a compatible API origin |
| `skills setup --mode local` | | Configure local-only mode without hosted credentials |
| `skills setup agents` | | Register the Skills MCP server with all supported agents |
| `skills list` | `ls` | List available skills (filter with `-c`, `--pinned`, `-t`, `--brief`) |
| `skills search <query>` | `s` | Search by name, description, or tags |
| `skills info <name>` | | Show metadata, env vars, and system dependencies |
| `skills docs <name>` | | Show documentation (SKILL.md > README.md > CLAUDE.md) |
| `skills requires <name>` | | Show env vars, system deps, and npm dependencies |
| `skills run <name> [args]` | | Execute a skill directly |
| `skills runs status <run-id>` | | Poll a remote skill run |
| `skills exports download <run-id>` | | Download completed remote artifacts |
| `skills update` | | Refresh project pin metadata |
| `skills diff <name>` | | Compare pin metadata against the bundled registry |
| `skills init` | | Generate `.env.example` and update `.gitignore` for pinned skills |
| `skills categories` | | List all categories with skill counts |
| `skills tags` | | List all unique tags with occurrence counts |
| `skills doctor` | | Check env vars, system deps, and pinned skill health |
| `skills test [name]` | | Test skill readiness (env, system, npm deps) |
| `skills outdated` | | Compare pinned vs registry versions |
| `skills auth login` | | Sign in to the hosted API with browser/device-code auth or email code |
| `skills billing status` | | Show hosted account plan and balance |
| `skills billing checkout` | | Create a hosted subscription checkout session |
| `skills billing portal` | | Create a hosted customer portal session |
| `skills credits buy <amount>` | | Create a hosted credit-pack checkout session |
| `skills setup-info` | | Version, pinned skills, agent configs, paths |
| `skills export` | | Export pinned skills as JSON |
| `skills import <file>` | | Pin skills from a JSON export |
| `skills config set <key> <value>` | | Set default agent, scope, or output format |
| `skills create <name>` | | Scaffold a new custom skill directory |
| `skills sync --to claude` | | Disabled by design; use `skills mcp --register <agent|all>` |
| `skills sync --from claude` | | Disabled by design; agent skill folders are not used |
| `skills validate <name>` | | Check a skill's directory structure |
| `skills schedule add <skill> <cron>` | | Set up recurring skill execution |
| `skills schedule list` | | List all schedules (enabled/disabled/last run) |
| `skills mcp` | | Start MCP server on stdio |
| `skills mcp --register claude` | | Register the Skills MCP server in an agent config (also `codex`, `gemini`, `opencode`, `all`) |
| `skills serve` | | Start the HTTP dashboard on localhost |
| `skills self-update` | | Update this package to the latest version |
| `skills completion <shell>` | | Generate shell completions (bash, zsh, fish) |

### Common Options

- `--json` — Output as JSON (pipeable)
- `--brief` — One-line format
- `--remote` — Read browse/search data from `SKILLS_API_URL` or `config apiUrl`
- `--dry-run` — Preview without applying changes
- `--verbose` — Debug logging to stderr
- `--no-color` — Disable ANSI colors
- `-o, --overwrite` — Refresh existing pin metadata

### JSON Output Contracts

Commands that support `--json` write exactly one JSON value to stdout and keep
human diagnostics off stdout. Error cases set a non-zero exit code and return an
object with an `error` field where the command shape is not already an array.

Stable command shapes:

- Browse: `list`, `search`, `categories`, `tags` return arrays.
- Skill details: `info`, `docs`, `requires`, `validate`, `diff`, `test`,
  `doctor`, `auth`, `whoami`, and `outdated` return command-specific objects or
  arrays documented by their field names.
- Project state: `pin`, `unpin`, `update`, `init`, `import`, `create`, and
  `sync` return result objects/arrays; `--dry-run --json` returns
  `{ "dryRun": true, "actions": [...] }` where applicable.
- Runtime: `run --json <skill> ...` returns
  `{ "skill", "args", "exitCode", "stdout", "stderr", "error", "run" }`.
  Premium remote runs include `{ "contractVersion": 1, "remote": true,
  "remoteRun", "pricing", "run", "nextActions" }` and return immediately with
  status commands such as `skills runs status <run-id>` and
  `skills exports download <run-id>`.
- Config and schedules: `config * --json` and `schedule * --json` return
  machine-readable status objects.
- MCP registration: `mcp --register <agent> --json` returns
  `{ "registered": number, "results": [...] }`.

## Remote Registry Mode

Local bundled skills remain the default for discovery. To point browse/search
commands at a compatible hosted registry, set an API base URL:

```bash
export SKILLS_API_URL=https://skills.md/api/v1
# or persist it:
skills config set apiUrl https://skills.md/api/v1

skills list --remote --json
skills search transcribe --remote --json
skills categories --remote
skills tags --remote --json
```

If the URL is an origin such as `https://skills.md`, the CLI requests
`/api/v1/skills`. If it already ends in `/api` or `/api/v1`, the CLI appends
`/skills`.

Authenticated remote listing and hosted premium execution use `SKILLS_API_KEY`
or the credential saved by `skills auth login`.

For the reusable upstream contract, see
`docs/architecture/reusable-skills-engine.md`.

## MCP Server

```bash
skills mcp    # stdio transport (use with Claude/Codex MCP config)
```

### HTTP mode

Long-lived Streamable HTTP transport (default port **8836**, bind `127.0.0.1` only):

```bash
skills-mcp --http
# or
MCP_HTTP=1 skills-mcp

# override port
skills-mcp --http --port 8836
MCP_HTTP_PORT=8836 skills-mcp --http
```

Endpoints: `GET /health` → `{"status":"ok","name":"skills"}`, MCP at `/mcp`.
Uses stateless `StreamableHTTPServerTransport` (shared process, many clients).
`skills-mcp` without flags still uses stdio (unchanged).

The MCP server exposes 20+ tools including `list_skills`, `search_skills`, `pin_skill`, `unpin_skill`, `pin_category`, `list_pinned_skills`, `get_skill_info`, `get_skill_docs`, `get_requirements`, `run_skill`, `get_run_status`, `schedule_skill`, `detect_project_skills`, `validate_skill`, and more.

### Register with an Agent

```bash
skills mcp --register claude    # Auto-register with Claude Code
skills mcp --register all       # Register with all supported agents
```

## Hosted Account

```bash
skills setup --mode hosted
skills auth login
skills billing status
```

Hosted account, billing, and credit management use the configured hosted API.
The public package only stores local configuration and CLI credentials; Stripe,
customer records, and hosted execution remain platform concerns.

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
│   ├── installer.ts         # Project pins and disabled source-copy paths
│   ├── project-state.ts     # .skills/project.json preferences
│   ├── run-state.ts         # .skills/runs and .skills/exports metadata
│   ├── skillinfo.ts         # Docs, requirements, env/system detection
│   ├── scheduler.ts         # Cron-based skill execution
│   ├── config.ts            # Global + project config loading
│   └── utils.ts             # normalizeSkillName()
├── index.ts                 # Library re-exports (npm package entry)
└── *.test.ts                # Test files

skills/                      # 202+ public skill contracts and local OSS skills
├── _common/                 # Shared utilities
└── */                       # Local skills include src/; premium package output excludes private src/

dashboard/                   # Next.js + React 19 + Tailwind v4 app
```

## Project Runtime State

Skills are discovered from the remote registry or bundled OSS registry. Project
folders and agent-native skill folders are never used as skill libraries.

`.skills/` is runtime/output state only:

```text
.skills/
├── project.json              # optional pins/preferences, no secrets
├── runs/YYYY-MM-DD/<run-id>/  # run.json, artifacts.json, events.ndjson, logs/
├── exports/<skill>/<run-id>/  # files produced by a run
└── tmp/
```

Auth stays global in `~/.hasna/skills/auth.json`. Registry and doc caches
belong in `~/.cache/skills` or the remote API, not inside project `.skills`.

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

1. Create `skills/{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, `SKILL.md`
2. Add an entry to the `SKILLS` array in `src/lib/registry.ts`
3. Run `skills validate <name> --json` to check package metadata, bin entries,
   docs, and SKILL.md frontmatter
4. Run `bun test` to verify registry-wide validation passes

Premium hosted skills should add public contracts, pricing, docs, and tests
without adding private provider routing, hosted worker code, or secrets to the
OSS package.

Custom skill directories are auto-discovered from `~/.hasna/skills/custom/`.
Project `.skills/` is reserved for runtime state and outputs.

## Data Directory

Global configuration is stored in `~/.hasna/skills/`. Auth is stored in
`~/.hasna/skills/auth.json`. Project runtime data is stored in `.skills/runs`,
`.skills/exports`, `.skills/tmp`, and optional `.skills/project.json`.

## License

Apache-2.0 — see [LICENSE](LICENSE)
