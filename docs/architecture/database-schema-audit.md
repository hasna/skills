# Database Schema Audit

This audit covers the current `hasnatools/platform-skills` repository before
building the PostgreSQL SaaS data model.

## Result

There is no existing Drizzle ORM SaaS schema in this repo yet.

The current repo is still the `@hasna/skills` package shape: CLI, MCP, local
server, local dashboard, skill corpus, and reusable engine modules. Searches for
Drizzle schema files, `pgTable`, `drizzle.config.*`, `DATABASE_URL`, and
application-level database modules found no platform database package or app
schema.

Database-related files that do exist are inside individual skills or examples,
such as:

- `skills/scaffold-project` templates.
- `skills/manageskill` local skill database helpers.
- `skills/managemcp` local skill database helpers.
- `skills/managehook` local skill database helpers.
- `skills/consolelog` local skill database helpers.
- `skills/database-explorer` skill runtime code.

Those are skill implementation details and must not be treated as the SaaS
platform schema.

## Implication

Phase 2 is not a schema hardening pass over existing SaaS tables. It is a new
database foundation for `skills.md`.

Before adding API, worker, billing, or web modules, create a dedicated database
package with:

- Drizzle config.
- PostgreSQL connection helpers.
- Schema definitions.
- Migration generation.
- Migration tests.
- Seed/sync hooks for the upstream skill registry artifact.

## Required SaaS Tables

The first schema must cover these product domains:

| Domain | Tables |
| --- | --- |
| Tenancy | organizations, teams, memberships, invitations |
| Identity | users, accounts, sessions, verification tokens |
| API access | api_keys, api_key_usage, service_tokens |
| Skill registry | skills, skill_versions, skill_aliases, skill_sources, skill_categories, skill_tags |
| Pins | skill_pins, agent_mcp_registrations, pin_events |
| Execution | skill_runs, run_steps, run_logs, run_events, run_artifacts |
| Async jobs | jobs, job_attempts, queues, scheduled_runs |
| Approvals | approval_requests, approval_decisions, approval_events |
| Billing | customers, subscriptions, credit_balances, credit_transactions, invoices, payment_events |
| Connectors | connector_accounts, connector_tokens, connector_scopes |
| Audit | audit_events, webhook_endpoints, webhook_deliveries |

## Required Cross-Cutting Fields

Every tenant-owned table should include:

- `id`
- `tenantId` or `organizationId`
- `createdAt`
- `updatedAt`
- `deletedAt` where soft deletion is needed

Every externally triggered or paid action should include:

- idempotency key
- request source
- actor/user id where available
- API key id where available
- agent identifier where available
- correlation id

Every skill registry and execution table should include source provenance:

- upstream package name
- upstream package version
- upstream git commit or artifact version
- canonical skill slug
- requested skill slug when different
- source type such as upstream, private-hosted, uploaded, or generated

## Immediate Follow-Up

The next Phase 2 implementation tasks should create a dedicated database module
rather than modifying skill-internal database examples:

1. Add schema package and Drizzle config.
2. Add skill source and artifact provenance fields.
3. Add approval tables.
4. Add execution status model.
5. Add billing and entitlement constraints.
6. Add tenant-scoped uniqueness and indexes.
7. Generate and test migrations.

## Non-Goals

- Do not use skill-local database helper code as platform state.
- Do not store tenant pins in local CLI config.
- Do not let workers, billing, or web routes create tables independently.
- Do not add PostgreSQL requirements to upstream-local skills unless the skill
  itself needs them.
