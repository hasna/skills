# @hasna/skills

Skills library for AI coding agents — discover, pin, and run reusable capabilities through the Skills CLI and MCP server for Claude Code, Codex CLI, Gemini CLI, OpenCode, and more.

[![npm](https://img.shields.io/npm/v/@hasna/skills)](https://www.npmjs.com/package/@hasna/skills)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install The CLI

```bash
bun install -g @hasna/skills
```

Requires [Bun](https://bun.sh/) 1.0+.

## Distribution And Service Boundary

`@hasna/skills` is the universal public package. It installs the CLI, SDK, MCP
client, and local engine; it can also connect to either the Skills cloud or a
compatible self-hosted service. It does not install the Skills cloud backend.

| Mode | Runtime authority | Network/account requirement |
| --- | --- | --- |
| `local` | This machine | No Skills account; local skills remain offline-capable unless their own docs explicitly declare an external provider. |
| `self-hosted` | An operator-owned Skills service | Explicit API URL and credentials issued by that operator. Hasna's internal AWS deployment is self-hosted, not cloud. |
| `cloud` | The Hasna-operated multi-tenant SaaS at `skills.md` | Skills cloud account. Live cloud capability and credit quotes are authoritative. |

The source candidate is `0.2.0`. A package is marketable as the new SaaS client
only after this version is published and the release smoke test passes against
the live cloud. Source readiness is not the same as npm availability.

## Quick Start

```bash
# Agent-first command discovery; never opens the TUI
skills

# The TUI is explicit
skills interactive

# Skills cloud (https://skills.md is the default)
skills setup --mode cloud
skills auth login

# Operator-owned service
skills setup --mode self-hosted --api-url https://skills.example.com
skills auth login --api-key "$SKILLS_API_KEY"

# Local-only setup
skills setup --mode local

# Connect the MCP server to every supported agent
skills mcp connect

# Discover, inspect, quote credits, and run
skills list
skills info image
skills quote image
skills run image "a cat sitting on a windowsill"
```

## Remote Runtime Skills

Premium skills are remote-only runs. The CLI and MCP server submit them to the
configured API, create local run metadata, and then expose status and artifact
commands. They do not fall back to bundled local execution when auth is missing
or the remote runtime is unavailable.

For Skills cloud:

```bash
skills setup --mode cloud
skills auth login
skills run image "editorial product photo on a white sweep"
skills runs status <run-id>
skills exports download <run-id>
```

An operator-owned service uses explicit self-hosted mode, its own origin, and
its own enrollment and authentication policy. Switching the configured origin
never reuses a stored credential issued by another service; sign in after a
switch. Explicit `SKILLS_API_KEY` environment input remains available for
automation.

`SKILLS_API_KEY` is a remote API credential. It is not a provider
credential and it does not prove that an origin is `selfhost` or `cloud`.
Provider keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`
remain supported only for free/local OSS skills whose requirements explicitly
document local provider use.

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `skills` | | Show command discovery help and exit |
| `skills interactive` | `i` | Open the interactive TUI to browse, search, and pin skills |
| `skills pin <name>` | | Pin one or more skills in `.skills/project.json`; no source is copied |
| `skills pin --category "Development Tools"` | | Pin all skills in a category |
| `skills unpin <name>` | | Remove a project pin |
| `skills pins list` | | List pinned skills |
| `skills setup --mode cloud` | | Configure the managed Skills cloud; defaults to `https://skills.md` |
| `skills setup --mode self-hosted` | | Configure self-hosted mode with a compatible API origin |
| `skills setup --mode local` | | Configure local-only mode without remote credentials |
| `skills mcp connect [agent]` | | Register the Skills MCP server with one agent or all supported agents by default |
| `skills list` | `ls` | List available skills (filter with `-c`, `--pinned`, `-t`, `--brief`) |
| `skills search <query>` | `s` | Search by name, description, or tags |
| `skills info <name>` | | Show metadata, env vars, and system dependencies |
| `skills show <name>` | | Show bundled or portable skill details |
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
| `skills auth login --api-key <key>` | | Verify and store a legacy remote API key |
| `skills auth login` | | Sign in to a compatible API with browser/device-code auth or email code |
| `skills billing status` | | Show the selected remote account plan and credit balance |
| `skills billing checkout` | | Create a checkout session when billing is enabled |
| `skills billing portal` | | Create a customer portal session when billing is enabled |
| `skills credits buy <amount>` | | Create a credit-pack checkout session when billing is enabled |
| `skills setup-info` | | Version, pinned skills, agent configs, paths |
| `skills export` | | Export pinned skills as JSON |
| `skills import <file>` | | Pin skills from a JSON export |
| `skills config set <key> <value>` | | Set default agent, scope, or output format |
| `skills new <name>` | `scaffold` | Scaffold a portable skill under `~/.hasna/skills/<name>` |
| `skills port <path>` | `add` | Import an existing skill folder into the portable standard |
| `skills create <name>` | | Scaffold a new custom skill directory |
| `skills sync --to claude` | | Disabled by design; use `skills mcp --register <agent|all>` |
| `skills sync --from claude` | | Disabled by design; agent skill folders are not used |
| `skills validate <name>` | | Check a skill's directory structure |
| `skills schedule add <skill> <cron>` | | Set up recurring skill execution |
| `skills schedule list` | | List all schedules (enabled/disabled/last run) |
| `skills storage status` | | Show local state paths and optional repo-native storage readiness |
| `skills storage sync-plan` | | Plan `.skills` Postgres/S3 snapshot sync without network access |
| `skills mcp` | | Start MCP server on stdio |
| `skills mcp --register claude` | | Register the Skills MCP server in an agent config (also `codex`, `gemini`, `opencode`, `all`) |
| `skills self-update` | | Update this package to the latest version |
| `skills completion <shell>` | | Generate shell completions (bash, zsh, fish) |

### Common Options

- `--json` — Output as JSON (pipeable)
- `--brief` — One-line format
- `--limit <n>` — Cap human rows where supported; use `--limit all` or `--limit 0` for every row
- `--cursor <n>` — Continue human-output pagination from a numeric offset
- `--remote` — Read browse/search data from `SKILLS_API_URL` or `config apiUrl`
- `--dry-run` — Preview without applying changes
- `--verbose` — Debug logging globally; richer human discovery rows where supported
- `--no-color` — Disable ANSI colors
- `-o, --overwrite` — Refresh existing pin metadata

### Compact Output Defaults

Agent-facing discovery commands are compact by default. `skills list --all`,
`skills search <query> --all`, `skills tags`, `skills runs list`, and
`skills schedule list` cap human output and print a next-page command when more
rows are available.

Use explicit disclosure controls when you need more:

```bash
skills list --all --limit 50
skills list --all --cursor 50 --limit 50
skills list --all --limit all
skills list --all --verbose
skills show image
skills search pdf --json
```

CLI `--json` output remains the machine-readable full result for browse/search
commands. Human output is optimized for terminals and agent context.

### JSON Output Contracts

Commands that support `--json` write exactly one JSON value to stdout and keep
human diagnostics off stdout. Error cases set a non-zero exit code and return an
object with an `error` field where the command shape is not already an array.

Stable command shapes:

- Browse: `list`, `search`, `categories`, `tags` return arrays.
- Skill details: `info`, `docs`, `requires`, `validate`, `diff`, `test`,
  `doctor`, `auth`, `whoami`, and `outdated` return command-specific objects or
  arrays documented by their field names.
- Project state: `pin`, `unpin`, `update`, `init`, `import`, `create`, `new`,
  `scaffold`, `port`, `add`, and `sync` return result objects/arrays; `--dry-run --json` returns
  `{ "dryRun": true, "actions": [...] }` where applicable.
- Runtime: `run --json <skill> ...` returns
  `{ "skill", "args", "exitCode", "stdout", "stderr", "error", "run" }`.
  Premium remote runs include `{ "contractVersion": 1, "remote": true,
  "remoteRun", "creditQuote", "run", "nextActions" }` and return immediately with
  status commands such as `skills runs status <run-id>` and
  `skills exports download <run-id>`.
- Config and schedules: `config * --json` and `schedule * --json` return
  machine-readable status objects.
- Storage: `storage status --json` returns local `.skills` paths and optional
  repo-native remote readiness; `storage sync-plan --json` returns a no-network
  snapshot plan.
- MCP registration: `mcp connect [agent] --json` and the compatibility command
  `mcp --register <agent> --json` return
  `{ "registered": number, "results": [...] }`.

## Remote Registry Compatibility

Local bundled skills remain the default for discovery. Cloud mode uses
`https://skills.md` by default. A self-hosted service uses its explicit API URL:

```bash
skills setup --mode cloud
# or
skills setup --mode self-hosted --api-url https://skills.example.com

skills list --remote --json
skills search transcribe --remote --json
skills categories --remote
skills tags --remote --json
```

If the URL is an origin such as `https://skills.md`, the CLI requests
`/api/v1/skills`. If it already ends in `/api` or `/api/v1`, the CLI appends
`/skills`.

Authenticated registry listing and remote premium execution use the credential
saved by `skills auth login` for the selected service or an explicit
`SKILLS_API_KEY` automation input.

For the target cross-product mode and profile contract, see
[Open Product Three-Mode Contract](docs/architecture/open-product-three-mode-contract.md).
For current Open Skills engine behavior and ownership boundaries, see
[Reusable Skills Engine](docs/architecture/reusable-skills-engine.md) and
[Open-Core Service Pattern](docs/architecture/open-core-saas-pattern.md).

The CLI now implements the three explicit deployment modes. The architecture
document also defines the reusable target for future products: adapter
selection, named profiles, independently scoped storage, service identity, and
portable data. Named multi-service profiles remain a follow-up; the current CLI
stores one selected service and binds its stored credential to that origin.

## Portable Skills

Portable skills live directly under `~/.hasna/skills/<name>/` and follow the
standard documented in `docs/skill-standard.md`.

```bash
skills new my-skill
skills validate my-skill
skills run my-skill --help
skills show my-skill

skills port ./existing-skill
```

The scaffold includes `SKILL.md`, `skill.json`, `AGENTS.md`, `package.json`,
`tsconfig.json`, and `src/index.ts`. `AGENTS.md` is written for coding agents:
after `skills new my-skill`, an agent can open that file, implement the skill,
update the manifest, run tests, and verify with `skills validate`.

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

The MCP server exposes 20+ tools including `list_skills`, `search_skills`,
`scaffold_skill`, `port_skill`, `pin_skill`, `unpin_skill`, `pin_category`,
`list_pinned_skills`, `get_skill_info`, `get_skill_docs`, `get_requirements`,
`run_skill`, `get_run_status`, `schedule_skill`, `detect_project_skills`,
`validate_skill`, and more.

MCP discovery and status tools use compact paged envelopes by default:
`list_skills` and `search_skills` return `skills` plus `total`, `offset`,
`limit`, and `nextOffset`; `list_schedules` returns the same metadata with a
`schedules` array. `run_skill` returns
stdout/stderr previews and compact run summaries unless the caller passes
`detail: true`. Use `get_skill_info`, `get_skill_docs`, or `detail: true` for
full records only when needed.

### Register with an Agent

```bash
skills mcp connect claude    # Register with Claude Code
skills mcp connect           # Register with all supported agents
```

`skills mcp --register <agent>` remains a compatibility alias.

## Remote Services

```bash
skills setup --mode cloud
skills auth login

skills setup --mode self-hosted --api-url https://skills.example.com
skills auth login --api-key "$SKILLS_API_KEY"
skills billing status
```

Account, run, log, artifact, and optional billing commands use the configured
remote API. Stored credentials include their issuing service origin and are not
sent after switching to a different origin; sign in to the newly selected
service. A future named-profile layer can retain several enrolled services at
once. The public package does not contain the SaaS backend; server runtime state
and artifact storage remain under the authority of the selected service.

The bundled provider-neutral self-hosted server advertises execution from its
actual handler registry. Its current provider-free handlers are
`audio-transcript-pack`, `transcript`, and `video-highlight-pack`; they quote
`0 credits`. Other catalog entries are returned as unavailable and run submit is
rejected before queue creation. The bundled server has no credit ledger,
reservation, debit, refund, commercial billing, or approval-policy engine.
Those remain explicit operator extensions until configured implementations and
their enforcement tests exist; package catalog credits are not self-hosted
server quotes.

Self-hosted API keys are scoped. Registry, run inspection, run mutation, and
artifact reads require `skills:read`, `runs:read`, `runs:write`, and
`artifacts:read` respectively. Fresh bootstrap keys receive those four scopes;
before restarting an existing server, run the bundled migrations. The upgrade
fingerprints the complete legacy internal bootstrap key, organization, and user
identity, then preserves its tenant data while moving it to the self-hosted
operator identity and four-scope contract. A matching name or legacy scope set
alone is never enough to select a key. Other previously provisioned keys remain
least-privilege and require an explicit operator scope update. Queued
cancellation is terminal immediately. A running worker observes
`cancel_requested`, and its terminal commit cannot overwrite the resulting
cancellation.

## Storage Boundary

Open Skills is local-first. Project runtime state stays in `.skills/`; global
config and auth stay under `~/.hasna/skills/`. Package storage mode is an
independent `local | remote | hybrid` axis: it does not select deployment mode
and does not authorize local or remote operation execution.

Optional repo-native sync can be configured without a self-hosted API account:

```bash
HASNA_SKILLS_STORAGE_MODE=hybrid # local | remote | hybrid
HASNA_SKILLS_DATABASE_URL=postgres://...
HASNA_SKILLS_S3_BUCKET=skills-artifacts
HASNA_SKILLS_S3_PREFIX=opensource/prod/skills

skills storage status
skills storage sync-plan --schema-sql
```

Wrappers and deployment tooling can import the storage-only surface without
pulling in CLI/runtime helpers:

```ts
import { getStorageStatus, resolveStorageConfig } from "@hasna/skills/storage";
```

Plain `SKILLS_DATABASE_URL`, `SKILLS_STORAGE_MODE`, and `SKILLS_S3_BUCKET`
fallbacks are accepted for local development. Legacy selfhost deployments
currently map server database and artifact settings into `HASNA_SKILLS_*`; that
is compatibility behavior, not proof of target isolation. Until the server
namespace migration lands, do not enable client sync against the same values or
present those shared names as two independent authorities.

These variables configure client-side package storage and sync. Current source
does not yet give the provider-neutral server a separate environment namespace.
Its shared reads are `HASNA_SKILLS_DATABASE_URL`,
`HASNA_SKILLS_S3_BUCKET`, and `HASNA_SKILLS_S3_PREFIX`; database pool settings
are server-only, and current server source does not read client S3 endpoint,
path-style, or package credentials. The artifact client separately reads
unscoped `AWS_REGION`. The proposed target server namespace is
`HASNA_SKILLS_SERVER_DATABASE_URL`,
`HASNA_SKILLS_SERVER_DATABASE_POOL_MAX`, `HASNA_SKILLS_SERVER_S3_*`, and
`HASNA_SKILLS_SERVER_AWS_REGION`. Its bounded dual-read window, precedence,
redacted diagnostics, migration preview, and server-scoped writes are target
compatibility behavior, not current implementation. Client sync configuration
must never be copied into or silently treated as the authoritative run, tenant,
or artifact database and bucket.

## Project Structure

```
src/
├── cli/index.tsx           # Commander.js CLI + Ink TUI
├── mcp/index.ts            # MCP server (stdio) with ~20 tools
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
└── */                       # Local skills include src/; self-hosted skills expose metadata/contracts
```

## Project Runtime State

Skills are discovered from the configured remote registry or bundled OSS
registry. Project folders and agent-native skill folders are never used as skill
libraries.

`.skills/` is runtime/output state only:

```text
.skills/
├── project.json              # optional pins/preferences, no secrets
├── runs/YYYY-MM-DD/<run-id>/  # run.json, artifacts.json, events.ndjson, logs/
├── exports/<skill>/<run-id>/  # files produced by a run
└── tmp/
```

Auth stays in one global record at `~/.hasna/skills/auth.json` and is bound to
the configured remote origin.
Registry and doc caches belong in `~/.cache/skills` or the selected remote API,
not inside project `.skills`.

## Development

```bash
bun install
bun run build              # Build CLI, MCP, library, and types
bun run dev                # Run CLI in dev mode (no build needed)
bun test                   # Run all tests
bun run typecheck          # TypeScript type checking
```

## Adding a New Skill

1. Create `skills/{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, `SKILL.md`
2. Add an entry to the `SKILLS` array in `src/lib/registry.ts`
3. Run `skills validate <name> --json` to check package metadata, portable
   manifests, bin entries, docs, and SKILL.md frontmatter
4. Run `bun test` to verify registry-wide validation passes

Premium remote-only skills should add public contracts, credit quotes, docs, and tests
without adding provider secrets to the OSS package.

Portable skill directories are auto-discovered from `~/.hasna/skills/<name>/`.
Legacy custom skill directories are still discovered from
`~/.hasna/skills/custom/`.
Project `.skills/` is reserved for runtime state and outputs.

## Data Directory

Global configuration is stored in `~/.hasna/skills/`. Auth is stored in
`~/.hasna/skills/auth.json`. Project runtime data is stored in `.skills/runs`,
`.skills/exports`, `.skills/tmp`, and optional `.skills/project.json`.

## License

Apache-2.0 — see [LICENSE](LICENSE)
