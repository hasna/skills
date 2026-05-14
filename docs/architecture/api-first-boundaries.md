# API-First Boundaries

skills.md must be API-first even when the first usable surfaces are CLI and
MCP. CLI, MCP, and future web UI clients are thin adapters over backend APIs,
service modules, and workers. Business rules must not exist only in a command,
tool handler, or React component.

## Boundary Rule

Every durable product behavior belongs in one of these backend-owned layers:

- Database schema and migrations for persisted state.
- Service modules for tenant-scoped business rules.
- HTTP API routes for request validation, auth, idempotency, and response
  contracts.
- Worker jobs for asynchronous execution, retries, and exports.
- Webhooks for external billing and connector events.

Client surfaces may format inputs, display outputs, and call APIs. They may not
own the canonical implementation of billing, entitlements, execution status,
pin state, approval policy, tenant isolation, or audit logging.

## Client Responsibilities

### CLI

The CLI is the primary agent setup and run surface. It should:

- Authenticate and store local API credentials securely.
- Call versioned HTTP APIs for hosted state.
- Print stable JSON for automation.
- Poll or stream execution status instead of executing hosted skills locally.
- Write project pins, run records, and artifact metadata only after API
  authorization.

The CLI should not duplicate server billing checks, tenant policy, moderation,
or execution scheduling.

### MCP

MCP tools are agent-native wrappers around the same API contracts. They should:

- Use the same request and response schemas as CLI commands.
- Return structured JSON payloads and structured errors.
- Expose approval, status, export, and billing actions as explicit tools.
- Avoid parsing human CLI output.

MCP tools should not bypass approval gates or call worker internals directly.

### Web UI

The web UI is a control plane over the same APIs. It should:

- Use shared client SDK calls for data loading and mutations.
- Prefer server-rendered pages for read views and client components only for
  interaction.
- Present the same execution, billing, approval, and audit state exposed to CLI
  and MCP.
- Avoid page-only business logic that cannot be tested through API contracts.

## Backend Contracts

Versioned API routes under `/api/v1` own product behavior:

- Registry reads: skills, categories, tags, detail, docs, pricing, provenance.
- Pin state: project pins, team enablement, requested slug, canonical slug.
- Execution: create run, get status, list logs, retrieve exports, cancel jobs.
- Billing: credits, subscriptions, checkout sessions, payment links, invoices.
- Approvals: create approval request, approve, reject, expire, audit.
- Connectors: auth status, connection metadata, token refresh status.
- Webhooks: delivery registration and delivery history.
- Admin: moderation queues, scan results, publish decisions.

Every API response should be stable enough for CLI, MCP, automated tests, and
future web clients to consume without scraping display text.

## Shared SDK

Create a shared typed client before web-specific data access grows:

- `packages/sdk` or `packages/api-client` should contain request helpers,
  response schemas, and typed errors.
- CLI, MCP, Playwright tests, and future React data loaders should use it.
- SDK methods should map one-to-one to API capabilities, not to UI screens.

## Worker Boundary

Workers execute asynchronous effects and report state back through the database:

- Skill execution workers never trust client-provided tenant, price, or approval
  decisions without reloading server state.
- Export workers write artifacts to object storage and persist metadata.
- Billing workers reconcile Stripe webhook events into a durable ledger.
- Notification workers deliver emails, webhooks, or chat messages from persisted
  events.

Clients observe worker state through API reads. They do not enqueue privileged
jobs directly.

## Testing Requirements

For every feature, coverage should exist at the lowest durable boundary:

- Service tests for business rules.
- API tests for auth, validation, idempotency, and response shape.
- Worker tests for retries and side effects.
- CLI/MCP tests for adapter behavior.
- Web tests for rendering and user interaction over API fixtures.

If a behavior can only be tested by clicking the web UI or running a CLI command,
the boundary is wrong. Move the behavior into a service/API layer first.
