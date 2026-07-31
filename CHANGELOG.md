# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Removed
- **The deployment "mode" concept is gone, in all three unrelated places it had
  grown.** Skills has one deployment story: you run it. Where it runs and who
  runs it were never product variants, and three separate subsystems had each
  invented a `mode` to describe them.
  - `skills setup --mode <self-hosted|local>` and the `mode` config key
    (including the eight-entry alias table that mapped `hosted`, `skills.md`,
    `selfhosted`, `offline` and friends onto two values). Setup now asks one
    question — `--api-url <url>` — and running on this machine is simply no API
    origin being configured, which needs no setup at all. A `mode` key left in
    an existing config file is ignored, not migrated; nothing reads it.
  - `HASNA_SKILLS_STORAGE_MODE` / `SKILLS_STORAGE_MODE`, the exported type
    `SkillsStorageMode`, and the functions `getStorageMode` /
    `getSkillsStorageMode` from both `@hasna/skills` and `@hasna/skills/storage`.
    Nothing ever branched on the label: it was echoed into `storage status` and
    `storage sync-plan` beside `databaseConfigured` / `s3Configured`, which are
    read from the configuration that is actually set and therefore cannot
    contradict it. On-box SQLite and files are always present; Postgres and S3
    are used when, and only when, their variables are set. The status and
    sync-plan payloads lose `mode`, `env.mode`, and `remote.activeModeEnv`, and
    the corresponding MCP tool output contracts lose `mode`.
  - `mode: "self-hosted"` from the server's `/health` and billing-credits
    payloads. `/health` reports liveness, not who is running the server.
- The first-run onboarding nudge (`src/cli/onboarding.ts`). It existed only to
  push users toward choosing a mode, and there is no longer a choice to make.

### Added
- **`skills sync [names...] [--for <agent>] [--dry-run] [--all] [--force]`** — the last
  mile: write skills from this machine's corpus into each coding agent's global skills
  folder (`~/.claude/skills/<name>/SKILL.md`, `~/.codex/…`, `~/.config/opencode/…`,
  `~/.cursor/…`), per-tool adapted (Claude keeps `user_invocable`; Codex/OpenCode/Cursor
  have it stripped). Instruction skills are written as prose the agent auto-loads;
  executable skills as a pointer to `skills run <name>`. **Non-clobbering**: every synced
  directory carries a `.hasna-skills.json` ownership marker, and a skill directory without
  it is treated as hand-authored and skipped unless `--force`. This replaces the disabled
  legacy `sync` command and reverses the `installSkillForAgent()` stub — that function now
  writes an agent skill folder (single-skill entry point to the same non-clobbering
  writer) instead of returning `success: false`. New library exports: `syncSkillsToAgents`,
  `writeManagedAgentSkill`, `writeManagedSkillDir`, `adaptSkillMdForAgent`,
  `agentGlobalSkillsDir`, `pointerSkillMd`, `resolveSyncAgents`, `removeManagedAgentSkill`,
  `SYNC_AGENTS`.
- **`skills pull [names...] [--all] [--for-machine]`** — fetch skills from the
  configured instance into this machine's corpus (`~/.hasna/skills/installed/<name>/`),
  the read half of the dogfooding loop that `skills push` writes to. Each skill's
  SKILL.md is written verbatim (the agent-facing artifact) with a canonical
  `skill.json` beside it, so `loadRegistry()` surfaces it to both `skills list --all`
  and the MCP `list_skills` tool with no further step. Fail-closed: with no instance
  origin configured it raises `MissingApiUrlError` rather than inventing a host (the
  vendor-host guard still holds); with no API key it names `skills login` /
  `SKILLS_API_KEY`. Re-pulling is idempotent — it overwrites SKILL.md/skill.json for a
  named skill but removes no sibling files. `--for-machine` implies `--all`. The new
  library entry point `pullSkills()` and corpus writer `writeCorpusSkill()` are exported
  from `@hasna/skills`.
- `CLAUDE.md` rewritten to describe the repository as it is, and a guard —
  `src/lib/claude-md.test.ts` — that re-derives its load-bearing counts from the
  tree on every run. The previous file had drifted back to roughly the v0.0.x
  shape: 202 skills where there are 229, 9 MCP tools where there are 38, 2 MCP
  resources where there are 4, a `dashboard/` directory and four npm scripts that
  do not exist, a `skill-` filesystem prefix that is gone, and — the most
  damaging line — the claim that the HTTP server "is not shipped in OSS" while
  `src/server/` was already shipping three of the five published bins. The guard
  checks one fixed table and nothing else: rewording the document cannot fail it,
  but adding a skill, an MCP tool, a bin, or a build step will, and the failure
  names the row and both numbers.

  The rewrite also records several things that were true but undocumented, and
  that adversarial review of the draft turned up: the MCP agent-session tools
  (`register_agent`, `heartbeat`, `set_focus`, `list_agents`) share a `Map` whose
  lifetime is one `buildServer()`, which under the default per-request HTTP
  transport means one request — so they are effectively stateless there;
  `auth-store.ts` freezes its paths from `homedir()` at import, so `auth.json`
  ignores `$HASNA_SKILLS_DIR` and is not covered by the hermetic-test override;
  `catalog-runnable.test.ts` guards a skill's `src/index.ts` but never its `bin`;
  `src/index.ts` and `src/storage.ts` duplicate the whole native-storage export
  list with nothing checking they agree; and `.skills/exports/` is a sibling of
  `runs/`, not nested inside it.
- `skills config unset <key>` (and the exported `unsetConfig`). With modes gone,
  "run on this machine" is the absence of a configured `apiUrl`, so there has to
  be a supported way back to that state; previously the only way to express the
  intent was `setup --mode local`.
- `skills setup --json` now reports `saved` (what this invocation wrote)
  separately from `apiUrl` (the origin in effect after merging global and
  project config), so the command can no longer claim a write it did not make
  when an origin is inherited from a wider scope. An explicitly empty
  `--api-url ""` is now an error rather than a silent no-op.

### Changed
- **`~/.hasna/skills/` is now the skills app folder and installed skills live in
  `~/.hasna/skills/installed/<name>/`.** App data (`config.json`, `skills.db`,
  `auth.json`) stays at the app root. This matches every sibling Hasna app —
  `mementos` keeps `agents/` beside `config.json`, `accounts` keeps `profiles/`,
  `knowledge` keeps `artifacts/` — and skills was the only one writing content
  into its own root.
- Skills from both older layouts (`~/.hasna/skills/<name>/` and the legacy
  `~/.hasna/skills/custom/<name>/`) are folded into `installed/` automatically the
  first time the corpus is resolved. The migration **copies and never deletes**,
  never overwrites an entry already under `installed/`, and leaves any directory
  carrying none of a skill's identifying files (`SKILL.md`, `skill.json`,
  `package.json`) exactly where it is.
- `HASNA_SKILLS_DIR` relocates the whole app folder; the corpus is always
  `<app folder>/installed`. It previously moved only the skills tree, because
  `getPortableSkillsRoot()` honoured it while `getDataDir()` ignored it — so
  `skills new` wrote to the override while `skills list` and `config.json` kept
  reading `$HOME`. Auth (`auth.json`) still resolves from `$HOME` at startup.

### Fixed
- **A skill may now be named `config`, `custom`, `auth`, or `installed`.** Those
  names were previously excluded outright by a denylist that existed only because
  the corpus shared the app root with app data. The denylist is deleted.
- Directories that are not skills are no longer listed as skills. Run output such
  as `~/.hasna/skills/deepresearch/{exports,logs}` was being read as a custom
  skill and shadowing the bundled `deepresearch` entry.
- `skills list`, `search`, and `info` no longer exit 1 with `ENOTDIR` when
  `HASNA_SKILLS_DIR` names a file rather than a directory.
- `getDataDir()` no longer throws when the configured data directory cannot be
  created (read-only parent, or the path is an existing file); read commands
  degrade to "no custom skills" instead of failing.
- `skills storage` reported a feedback-database path that differed from the one
  actually written when the data directory was relocated.
- `skills create` wrote to the legacy `custom/` folder and ignored
  `HASNA_SKILLS_DIR`; it now writes to the resolved corpus.
- The registry's 5s cache is keyed on the resolved data directory, so changing
  `HASNA_SKILLS_DIR` or `$HOME` no longer serves entries from the previous root.

## [0.1.60] - 2026-07-25

### Fixed
- `skills auth signup`/`auth login` no longer fail with a bare, unactionable
  message such as "Something went wrong!". API failures now report the HTTP
  status and the exact endpoint that was called, non-JSON error bodies (proxy
  or CDN HTML pages) are condensed to a single readable line instead of being
  dumped raw, and 401/403/404/405/501 responses add a hint pointing at
  `SKILLS_API_URL` / `skills setup` for a misconfigured API URL (#24).
- `--json` auth/billing failures now carry `endpoint` and `apiUrl` alongside
  `error`/`status`/`code`/`detail` (#24).
- Reported endpoints strip any credentials embedded in the configured API URL
  (`https://user:pass@host`) so they are never echoed to the terminal or into
  `--json` output (#24).

## [0.1.59] - 2026-07-24

### Fixed
- Rebranded "Open Skills" to "Hasna Skills" and scrubbed internal domain/infra
  leakage from published output (#34).
- `doctor --json` now always emits an array shape for stable machine parsing
  (#43).
- `list`/`search` reject unknown `--format` values instead of silently falling
  back (#44).
- `doctor`/`test` diagnostics verify npm dependencies so reported readiness is
  truthful (#41).
- Shell completion derives subcommands from the live command tree, enumerating
  the real subcommands (runs, exports, storage, webhooks, events) (#42).

### Added
- Hardened squash-merge provenance handling (#40).

## [0.1.54] - 2026-06-29

### Fixed
- Corrected the `project-dashboard-reports` Mailery provider-panel example to
  use the released `mailery project-panel` command.

## [0.1.53] - 2026-06-29

### Fixed
- Tightened the `project-dashboard-reports` CLI checklist so provider-panel
  examples match the bounded limits and project-scoped knowledge command in the
  full skill guidance.

## [0.1.52] - 2026-06-29

### Added
- Bundled `project-dashboard-reports` skill for Hasna agent-managed project
  dashboards, `.hasna/project` layout, Projects JSON Render/React Flow viewer
  workflow, provider panel commands, `#iproj-*` channel naming, and redaction
  boundaries.

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
