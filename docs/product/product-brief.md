# @hasna/skills Product Brief

`@hasna/skills` is a local-first skill library, CLI, and MCP server for AI
coding agents. It gives agents a reusable catalog of documented skills without
requiring a hosted account, private infrastructure, or source-copy installs.

The open package can optionally talk to a compatible hosted API such as
skills.md for remote-only skills. That remote path is explicit configuration,
not a dependency of the core package.

## Target Users

- Agent users who want skills available through CLI and MCP in Claude Code,
  Codex, Gemini, OpenCode, and other runtimes.
- Teams that want a stable open registry they can mirror, audit, or wrap.
- Skill authors who want reusable docs, metadata, validation, and package
  conventions.
- Hosted-service builders who need a clean public package to wrap without
  copying private infrastructure into open source.

## Core Use Cases

- Browse, search, inspect, and pin bundled skills from the CLI or MCP.
- Run free or explicitly local skills on the user's machine.
- Configure first-run mode as local-only or a compatible hosted API.
- Submit hosted skills to a remote API when the skill contract says the source
  is server-executed.
- Export machine-readable registry, MCP, config, quote, run, and validation
  contracts.
- Keep project `.skills` state limited to preferences, pins, schedules, runs,
  exports, and logs.

## V1 Scope

V1 must keep the public package useful on its own:

- `skills` CLI and `skills-mcp` server ship from npm package `@hasna/skills`.
- Local setup supports local-only mode without API credentials.
- Optional hosted setup stores a configurable API URL and uses explicit auth.
- Premium or remote-only skills fail closed without hosted credentials and do
  not fall back to bundled local execution.
- Public package exports expose reusable registry, config, validation,
  discovery, pricing, and remote-run contract APIs.
- Package output excludes private hosted source and private infrastructure
  dependencies.

## Non-Goals

- Depending on private cloud packages or hosted infrastructure to use the CLI.
- Publishing private worker, billing, tenant, or deployment code in the open
  npm package.
- Copying protected hosted skill source into user projects.
- Making a browser dashboard the primary workflow for agents.
- Becoming a generic workflow automation platform.

## Pricing Principles

- The open package can describe hosted skill prices and quote contracts.
- Billing, payment methods, credits, ledgers, and entitlements are hosted API
  responsibilities, not OSS core dependencies.
- Agent-visible errors must explain when a skill is hosted and which login or
  setup command is needed.
- Local skills should remain runnable without hosted spend or hosted state.

## Trust Model

The open package assumes local execution is user-owned and hosted execution is
server-owned.

- Local projects store only local preferences and run artifacts.
- Provider keys stay local only for explicitly local skills that document them.
- Hosted skills expose public docs, schemas, pricing, and remote contracts, not
  protected implementation source.
- Remote APIs own account state, approvals, billing, and server-side secrets.
- CLI and MCP surfaces return structured errors so agents can handle missing
  credentials and hosted failures without executing private source locally.

## Agent-Native Surfaces

Agent-native means the core workflow works from tools an agent already has:

- Discover: list and search skills through CLI and MCP.
- Configure: choose local mode or a compatible hosted API.
- Execute: run local skills directly or submit hosted skills remotely.
- Inspect: poll remote status, read local logs, and retrieve exports.
- Validate: expose package and skill checks as scriptable commands.

Future hosted dashboards should consume the same API contracts used by CLI and
MCP, without making the agent workflow dependent on a browser.
