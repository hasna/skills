# Changelog

All notable changes to this project will be documented in this file.

## [0.1.12] - 2026-03-12

### Added
- REST `?fields=` filtering on `GET /api/skills`, `/api/skills/search`, `/api/skills/:name` — specify only the fields you need (60-80% response size reduction)
- CLI `--format=compact` — outputs skill names only (one per line)
- CLI `--format=csv` — outputs `name,category,description` CSV for agent processing

### Changed
- Compact mutation responses — `POST /api/skills/:name/install` and `/remove` return minimal `{skill,success}` on success; full detail only on failure (~80% smaller on mutations)

## [0.1.11] - 2026-03-12

### Changed
- MCP lean stubs — stripped all param `.describe()` annotations from inputSchema across all 16 tools. Full descriptions available on demand via `describe_tools`.

## [0.1.10] - 2026-03-12

### Added
- MCP `search_tools` tool — list tool names, optionally filtered by keyword
- MCP `describe_tools` tool — get full descriptions for specific tools by name (on-demand schema lookup)

## [0.1.9] - 2026-03-12

### Changed
- `list_skills` and `search_skills` MCP tools now return `[{name,category}]` by default — add `detail: true` for full objects (~90% token reduction on discovery calls)
- `skills://registry` resource now compact `[{name,category}]` instead of full objects
- All 14 MCP tool descriptions trimmed to ≤60 chars
- Non-TTY CLI default output changed to compact `[{name,category}]` (use `skills list --json` for full objects)
- `get_skill_info` strips null/empty fields from response

## [0.1.8] - 2026-03-11

### Added
- `skills install --category <cat>` — bulk install all skills in a category
- `skills export` / `skills import` — portable skill configs across machines
- `skills whoami` — setup summary (installed skills, agent configs, env vars, version)
- `skills test [name]` — verify env vars and system deps are ready
- `skills auth [name]` — check and set env vars per skill (`--set KEY=VALUE`)
- `--brief` flag on list, search, info for compact one-line-per-skill output
- MCP tools: `install_category`, `export_skills`, `import_skills`, `whoami`
- REST API: `POST /api/skills/install-category`, `GET /api/export`, `POST /api/import`
- Dashboard: keyboard shortcuts (/, j/k, Enter, Escape, ? help overlay)
- Dashboard: bulk install/remove with checkbox selection and floating action bar
- Dashboard: enhanced detail panel (env var status, system deps, Copy MCP config, agent install buttons)
- 365 tests across 10 files

## [0.1.6] - 2026-03-11

### Added
- Fuzzy search in `searchSkills()` — typos and abbreviations are tolerated (Levenshtein edit distance + prefix matching)
- `skills tags` command lists all tags with skill counts (CLI, MCP `list_tags` tool, REST `GET /api/tags`)
- `--tags` filter on `skills list` and `skills search` (comma-separated, OR logic, case-insensitive)
- `skills init --for <agent>` smart init — detects project type from package.json and installs recommended skills
- `detectProjectSkills()` function in skillinfo module (exported from library)
- `getSkillsByTag()` and `getAllTags()` registry functions (exported from library)
- 290 tests across 10 files

## [0.1.5] - 2026-03-10

### Changed
- Server defaults to OS-assigned port (port 0) instead of hardcoded 3579 — prevents port conflicts
- Self-update reads package name dynamically from package.json (forks work correctly)

### Fixed
- Removed hardcoded `@hasna/skills` in CLI and server self-update commands
- Stale port reference in README

### Added
- Test coverage for server (version, agent install, self-update, no-dashboard), installer (dependency warnings), skillinfo (CLAUDE.md fallback)
- 244 tests, 99% function coverage, 96% line coverage

## [0.1.2] - 2026-02-15

### Added
- Hasna branding on dashboard (logo + "Hasna Skills" header)
- CLAUDE.md for AI agent development guidance
- Full test coverage: 213 tests across 10 files
- Server API tests (src/server/serve.test.ts)
- MCP tool/resource tests (get_skill_docs, get_requirements, list_skills, install/remove, registry resource)
- resolveAgents unit tests

## [0.1.1] - 2026-02-15

### Added
- Skills Dashboard: Vite + React 19 + Tailwind v4 + shadcn/ui web UI
- Bun HTTP server with 7 REST API routes
- `skills serve` command to launch web dashboard
- Interactive TUI as default command (TTY detection)
- Dashboard: skills table with search, sort, pagination (TanStack Table)
- Dashboard: stats cards, skill detail dialog, dark/light theme toggle
- `dashboard:dev`, `dashboard:build`, `server`, `server:dev` scripts

## [0.0.3] - 2025-01-15

### Changed
- Version bump to 0.0.3

## [0.0.2] - 2025-01-14

### Changed
- Consolidated skills from 266 to 200 (removed scaffolds, merged duplicates)
- Updated repository URL and description

## [0.0.1] - 2025-01-13

### Added
- Initial release with 266 AI agent skills
- CLI with interactive TUI (ink/React)
- MCP server for AI agent integration
- Programmatic API
- Support for Claude, Codex, and Gemini agents
