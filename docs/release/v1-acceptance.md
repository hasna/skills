# V1 Acceptance Criteria And Launch Checklist

skills.md v1 is accepted only when an agent can discover, pin, execute, pay
for, and retrieve outputs from skills through CLI and MCP, with the same backend
APIs ready for a future web interface.

## Product Acceptance

- The product brief, API boundary, skill model, and approval model are current.
- `skills.md` is the production domain.
- Local development uses port `3505` for the SaaS web app.
- The open `hasna/skills` package remains upstream for reusable engine changes.
- The private SaaS app keeps PostgreSQL, Stripe, AWS, hosted execution, and
  tenant state out of upstream package changes.

## CLI Acceptance

- User can authenticate and manage API credentials.
- User can list/search remote registry skills with JSON output.
- User can pin a remote skill without downloading manifests, source, scripts, or
  runtime files into the project.
- User can run a hosted skill asynchronously by default.
- User can poll execution status and retrieve logs/exports.
- User can inspect billing, credits, invoices, and approval status.
- CLI errors are structured and scriptable with `--json`.

## MCP Acceptance

- Agent can list/search/pin skills through MCP tools.
- Agent can request hosted execution and receive an execution id.
- Agent can poll status and retrieve export metadata.
- Agent can request approval for paid or sensitive actions.
- Tool results and errors are structured JSON.
- MCP tests cover success, error, approval, and async execution paths.

## API Acceptance

- `/api/v1` exposes stable contracts for registry, pin state, executions,
  exports, billing, approvals, connectors, webhooks, and moderation.
- Auth supports user sessions and API keys.
- Tenant isolation is enforced in every stateful query.
- Mutating endpoints support idempotency keys where retries can happen.
- Response schemas are tested and usable by CLI, MCP, web, and tests.

## Database Acceptance

- PostgreSQL migrations cover tenants, users, API keys, skills, pins,
  executions, artifacts, approvals, credits, billing events, connector state,
  audit logs, moderation, and webhook deliveries.
- Tenant-scoped uniqueness and indexes exist for hot paths.
- Migration generation and migration execution are tested.
- Backup and restore runbooks exist before production launch.

## Worker Acceptance

- Remote execution workers process queued runs with retries and idempotency.
- Workers re-check approvals, credits, tenant policy, and connector state before
  side effects.
- Export lifecycle writes artifacts to object storage and persists metadata.
- Failed paid runs trigger the documented refund or reversal behavior.
- Worker tests cover success, failure, retry, timeout, and duplicate delivery.

## Billing Acceptance

- Stripe test mode supports subscriptions, credit packs, Checkout or Payment
  Link flows, invoices, webhook reconciliation, and refunds/reversals.
- Agents can request payment flows only through approval-gated APIs.
- Billing ledger entries reconcile to Stripe webhook events.
- Spend limits and approval thresholds are enforced server-side.
- Sandbox payment tests pass before production secrets are used.

## Security Acceptance

- Threat model is documented.
- Secrets are stored in approved secret stores and never committed.
- Skill moderation and scanning gate public publication.
- Hosted skill execution is sandboxed by runtime profile.
- API auth, tenant isolation, approvals, billing, and connector writes have
  regression tests.

## Web-Ready Acceptance

- All dashboard views planned for v1 have API coverage.
- Web UI can be built as a thin client over the same API contracts.
- Pagination, filtering, and stable response schemas exist for list views.
- No business logic exists only in frontend components.

## Deployment Acceptance

- AWS resources are in the hasna-tools account.
- PR preview deployments exist and run smoke tests.
- Production deploys are tag-gated.
- `skills.md` DNS, TLS, app URL, and callback URLs are configured.
- Observability includes health checks, structured logs, metrics, alerts, and
  rollback steps.

## Required Gates Before Launch

All gates must pass from a clean checkout:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
```

SaaS app gates must also pass once the web app exists:

```bash
bun run test:e2e
bun run test:api
bun run test:mcp
bun run test:cli
```

On Linux, `bun test` must run through the configured memory guard or equivalent
`systemd-run --user --scope` limits.

## Launch Decision

Do not launch v1 while any critical acceptance area is incomplete. A launch
candidate needs:

- All critical/high plan tasks complete.
- Full local gates passing.
- PR preview smoke tests passing.
- Stripe sandbox payment tests passing.
- Production deployment dry run passing.
- Rollback plan rehearsed.
- Secrets scan clean.
- Human approval flow tested end to end.
