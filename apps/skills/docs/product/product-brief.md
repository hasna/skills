# @hasna/skills Product Brief

`@hasna/skills` is a local-capable and server-backed skill library, CLI, MCP
server, API, and worker runtime for AI coding agents. It can be pointed at a
compatible API for server-executed skills, while local-only usage remains
available without requiring an API account or source-copy installs.

The open package can optionally talk to a Skills API for server-executed skills.
It ships with no endpoint of its own: the authority comes from the shared
@hasna/contracts client ladder — `HASNA_SKILLS_API_URL`, the macOS Keychain
`api-url` item, `~/.hasna/skills/config/credentials`, then the fleet gateway once
a credential has resolved. An operator naming their own instance writes it with
`skills setup --api-url <origin>`. That API path is explicit configuration, and
the on-machine run is explicit too — the deliberate opt-in `HASNA_SKILLS_LOCAL=1`:
an install with no credential and no opt-in fails closed (non-zero exit, no local
database, no local-fallback event) and an install with no credential never sends
anything anywhere.

## Target Users

- Agent users who want skills available through CLI and MCP in Claude Code,
  Codex, Gemini, OpenCode, and other runtimes.
- Teams that want a stable open registry they can mirror, audit, or wrap.
- Skill authors who want reusable docs, metadata, validation, and package
  conventions.
- Operators who need a deployable Skills server without copying
  provider secrets or deployment state into local projects.

## Core Use Cases

- Browse, search, inspect, and pin bundled skills from the CLI or MCP.
- Run free or explicitly local skills on the user's machine (with the deliberate
  `HASNA_SKILLS_LOCAL=1` opt-in when nothing else is configured).
- Point the CLI at a compatible API origin, or at the opt-in and stay local-only.
- Submit server-executed skills to the API when the skill contract says execution
  is server-owned.
- Export machine-readable registry, MCP, config, quote, run, and validation
  contracts.
- Keep project `.skills` state limited to preferences, pins, schedules, runs,
  exports, and logs.

## V1 Scope

V1 must keep the public package useful on its own:

- `skills` CLI and `skills-mcp` server ship from npm package `@hasna/skills`.
- Setup stores a configurable API URL and uses explicit client auth. It writes
  no API origin the user did not supply, interactively or not, which is what
  keeps local/CI use safe by default.
- Premium or server-executed skills fail closed without API credentials and do not
  fall back to bundled local execution.
- Public package exports expose reusable registry, config, validation,
  discovery, pricing, and remote-run contract APIs.
- Package output excludes provider secrets and deployment-only infrastructure
  dependencies.

## Non-Goals

- Depending on private service packages or AWS infrastructure to use the local
  CLI.
- Publishing private worker, billing, tenant, or deployment code in the open
  npm package.
- Copying protected server-executed skill source into user projects.
- Making a browser dashboard the primary workflow for agents.
- Becoming a generic workflow automation platform.

## Pricing Principles

- The open package can describe server-executed skill prices and quote contracts.
- Billing, payment methods, credits, ledgers, and entitlements are API
  responsibilities, not OSS core dependencies.
- Agent-visible errors must explain when a skill requires the server runtime and
  which login or setup command is needed.
- Local skills should remain runnable without server spend or API state.

## Trust Model

The open package assumes local execution is user-owned and server-side execution
is server-owned.

- Local projects store only local preferences and run artifacts.
- Provider keys stay local only for explicitly local skills that document them.
- Server-executed skills expose public docs, schemas, pricing, and run contracts,
  not protected implementation source.
- APIs own account state, approvals, billing, and server-side secrets.
- CLI and MCP surfaces return structured errors so agents can handle missing
  credentials and server failures without executing private source locally.

## Agent-Native Surfaces

Agent-native means the core workflow works from tools an agent already has:

- Discover: list and search skills through CLI and MCP.
- Configure: set an API origin for server-executed skills, or none at all.
- Execute: run local skills directly or submit server-executed skills to the API.
- Inspect: poll run status, read local logs, and retrieve exports.
- Validate: expose package and skill checks as scriptable commands.

Future operator dashboards should consume the same API contracts used by CLI and
MCP, without making the agent workflow dependent on a browser.
