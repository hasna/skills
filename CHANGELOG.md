# Changelog

All notable changes to this project will be documented in this file.

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
