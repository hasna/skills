# Upstream Boundary

`hasnatools/platform-skills` is a private SaaS product built from `hasna/skills`.
The repo keeps `hasna/skills` as the `upstream` remote so generic improvements
can move back to the open package without dragging private SaaS concerns into it.

## Remotes

- `origin`: `hasnatools/platform-skills`
- `upstream`: `hasna/skills`

Use `origin` for the private SaaS product. Use `upstream` only to pull generic
engine improvements from `hasna/skills` or to prepare reusable changes that can
be proposed back to `hasna/skills`.

## Upstream-Compatible Changes

Changes can be prepared for `hasna/skills` when they are useful without the
private SaaS platform:

- CLI support for a configurable remote registry or API endpoint, such as
  `SKILLS_API_URL`, while keeping the bundled local registry as the default.
- Consistent machine-readable `--json` output for CLI commands.
- MCP tool schema, registration, and transport improvements that do not depend
  on private billing, tenant, or deployment infrastructure.
- Skill packaging, metadata, and validation improvements.
- Pinning and runtime-state abstractions that keep project `.skills` as
  preferences, runs, exports, logs, and metadata only.
- Tests and documentation for generic skill engine behavior.

## Private SaaS Changes

These belong only in `hasnatools/platform-skills`:

- PostgreSQL schema, migrations, tenants, users, organizations, sessions, API
  keys, and audit logs.
- Stripe billing, credits, entitlements, spend limits, invoices, webhooks, and
  payment approval flows.
- Private hosted skills, remote execution workers, queues, logs, exports, S3
  storage, and execution sandboxes.
- Admin moderation, private dashboards, analytics, support tooling, and
  customer-specific workflows.
- AWS infrastructure, Terraform, PR previews, production deploys, secrets
  wiring, observability, alerting, and rollback automation.

## Sync Rules

1. Pull from `upstream/main` intentionally and review conflicts as product
   decisions.
2. Keep SaaS-only code behind private modules, packages, or app directories.
3. When a change improves the skill engine generally, isolate it from SaaS
   dependencies and cover it with tests.
4. Do not hard-code `skills.md`, Hasna Tools AWS details, Stripe products, or
   private API contracts into upstream-compatible modules.
5. Preserve local-first behavior for the open package. Remote mode is additive.

For the step-by-step upstream PR process and preflight script, see
`docs/architecture/upstream-sync.md`.

## Current Product Direction

The SaaS product wraps the open skill engine with server-owned state and
execution:

- Agents keep using CLI and MCP surfaces.
- The backend owns registry sync, pin tracking, remote execution, billing,
  auditability, and exports.
- A future web interface consumes the same API contracts as the CLI and MCP
  tools.
