# @hasna/skills Product Brief

`@hasna/skills` is the universal local, self-hosted, and cloud skill library,
CLI, MCP server, API client, and worker runtime for AI coding agents. The bare
command is agent-first and prints commands; the TUI is explicitly opt-in.

The package can talk to the Hasna customer SaaS at `https://skills.md` in
`cloud` mode or to an operator URL in `self-hosted` mode. Hasna internal AWS
infrastructure is self-hosted, not cloud. Neither remote path is a dependency
of local-only use.

## Target Users

- Agent users who want skills available through CLI and MCP in Claude Code,
  Codex, Gemini, OpenCode, and other runtimes.
- Teams that want a stable open registry they can mirror, audit, or wrap.
- Skill authors who want reusable docs, metadata, validation, and package
  conventions.
- Operators who need a deployable self-hosted Skills service without copying
  provider secrets or deployment state into local projects.

## Core Use Cases

- Browse, search, inspect, and pin bundled skills from the CLI or MCP.
- Run free or explicitly local skills on the user's machine.
- Configure first-run mode as cloud, self-hosted, or local-only.
- Submit remote skills to the selected API when the skill contract says execution
  is server-owned.
- Export machine-readable registry, MCP, config, quote, run, and validation
  contracts.
- Keep project `.skills` state limited to preferences, pins, schedules, runs,
  exports, and logs.

## V1 Scope

V1 must keep the public package useful on its own:

- `skills` CLI and `skills-mcp` server ship from npm package `@hasna/skills`.
- Setup explicitly selects cloud, self-hosted, or local mode; package install
  and the bare command remain non-interactive.
- Cloud defaults to `https://skills.md`; self-hosted stores an explicit API URL.
  Stored credentials are bound to the service origin that issued them.
- Premium or server-executed skills fail closed without remote credentials
  and do not fall back to bundled local execution.
- Public package exports expose reusable registry, config, validation,
  discovery, credit-quote, and remote-run contract APIs.
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

## Credit Principles

- Customer-facing CLI, MCP, docs, and API contracts show credits and credit
  quotes, never currency, cents, provider cost, or margin.
- Billing, payment methods, credits, ledgers, and entitlements are API
  responsibilities, not OSS core dependencies.
- Agent-visible errors must explain when a skill requires a remote
  runtime and which login or setup command is needed.
- Local skills should remain runnable without remote credits or API state.

## Trust Model

The open package assumes local execution is user-owned and remote execution is
owned by the selected self-hosted or cloud service.

- Local projects store only local preferences and run artifacts.
- Provider keys stay local only for explicitly local skills that document them.
- Remote skills expose public docs, schemas, credit quotes, and run contracts,
  not protected implementation source.
- APIs own account state, approvals, billing, and server-side secrets.
- CLI and MCP surfaces return structured errors so agents can handle missing
  credentials and self-hosted failures without executing private source locally.

## Agent-Native Surfaces

Agent-native means the core workflow works from tools an agent already has:

- Discover: list and search skills through CLI and MCP.
- Configure: choose cloud, self-hosted, or local mode.
- Execute: run local skills directly or submit remote skills to the selected API.
- Inspect: poll run status, read local logs, and retrieve exports.
- Validate: expose package and skill checks as scriptable commands.

Future operator dashboards should consume the same API contracts used by CLI and
MCP, without making the agent workflow dependent on a browser.
