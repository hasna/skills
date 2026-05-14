# skills.md Product Brief

skills.md is an agent-native SaaS platform for discovering, pinning, running,
and governing reusable AI agent skills. It wraps the open `hasna/skills` engine
with MCP-first discovery, hosted state, remote execution, billing, approvals,
auditability, and a future web interface.

The product direction follows the same simplicity principle as agent-native
tools such as AgentCard: the first-class surfaces are CLI, MCP, and API. The web
interface exists to inspect, govern, and configure the same contracts rather
than becoming a separate product path.

## Target Users

- Agent builders who want reliable skills available through MCP in Claude Code,
  Codex, Gemini, OpenCode, and other agent runtimes.
- Technical teams that need shared, audited skill execution across projects and
  organizations.
- Skill authors who want to publish reusable skills without building billing,
  hosting, moderation, and distribution.
- Operations and security owners who need approvals, logs, limits, and
  revocation for agent actions.

## Core Use Cases

- Browse a registry of free and paid skills from CLI, MCP, API, or web.
- Pin project-relevant skills without copying skill definitions, source, or
  runtime files into the project.
- Run skills asynchronously and retrieve status, logs, exports, and generated
  artifacts.
- Connect third-party accounts through platform connectors without exposing
  secrets to local machines.
- Let agents request paid or sensitive actions through explicit human approval.
- Track usage, credits, billing events, and audit logs per tenant.
- Publish and moderate new skills with provenance, tests, and security checks.

## V1 Scope

V1 must ship a complete agent-native loop:

- PostgreSQL-backed tenants, users, API keys, skill pins, executions,
  exports, credits, billing events, approvals, and audit logs.
- Registry sync from the open `hasna/skills` package plus hosted/private skill
  metadata.
- CLI commands for login, pin, run, status, exports, billing, and API key
  management.
- MCP tools for listing, pinning, running, checking execution status,
  retrieving exports, and requesting approvals.
- Remote execution workers with queue retries, idempotency, logs, and export
  storage.
- Stripe billing for subscriptions, credit packs, invoices, webhooks, and
  agent-requested Checkout or Payment Link flows.
- Security moderation for uploaded or generated skills.
- API contracts that can power the future web dashboard without changing CLI or
  MCP behavior.
- AWS deployment in the hasna-tools account with PR previews and
  tag-gated production releases for `skills.md`.

## Non-Goals

- Running paid or untrusted hosted skill source code on the user's machine.
- Building a dashboard-only marketplace before CLI, MCP, and API flows work.
- Supporting every possible agent runtime before Claude Code, Codex, Gemini,
  and MCP are solid.
- Becoming a generic workflow automation platform.
- Shipping private SaaS state back into the open `hasna/skills` package.
- Allowing agents to spend money or access sensitive connectors without explicit
  policy and approval controls.

## Pricing Principles

- Free skills should be discoverable, pinnable, and runnable where there is no
  hosted cost.
- Hosted execution should be metered by credits so expensive skills can scale
  with usage.
- Paid skills should protect source code while still exposing clear
  instructions, inputs, outputs, and pricing.
- Agent-generated payment flows must be bounded by tenant policy, spend limits,
  approval state, and idempotency keys.
- Billing must be auditable: every credit debit, refund, invoice event, and
  approval decision needs a durable ledger entry.

## Trust Model

The platform assumes agents can propose actions, but humans and tenant policy
control sensitive execution.

- Local projects store pins and run outputs only; skill docs, manifests, and
  source stay in the MCP/API registry or bundled package.
- Server workers execute hosted skills inside constrained runtime profiles.
- Connectors and provider API keys stay server-side unless a skill is explicitly
  local and user-owned.
- Paid, destructive, or externally visible actions require approval gates.
- Every execution has tenant, actor, skill, input hash, status, duration, cost,
  logs, exports, and provenance.
- Moderation and security scans gate public skill publishing.

## What Agent-Native Means

Agent-native means an agent can complete the core workflow from its own tool
surface:

- Discover: list and search skills through CLI/MCP/API.
- Configure: register the Skills MCP and pin project-relevant skills without
  copying protected remote source.
- Execute: start a run, poll status, and retrieve outputs asynchronously.
- Pay: request credits, Checkout, or payment links through explicit approval.
- Govern: expose machine-readable errors, limits, logs, and audit references.

The web interface is still important, but it is not the source of truth. It
should consume the same API contracts used by CLI and MCP, making the platform
web-ready without making the agent workflow dependent on a browser.
