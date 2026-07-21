# Database Boundary Audit

This audit documents the public package database boundary.

## Historical status

This audit predates the portable-server contract and is retained as historical
context. The current canonical ownership rules are
[Open Product Three-Mode Contract](open-product-three-mode-contract.md) and
[Package Ownership And Sync Strategy](package-ownership-sync-strategy.md).
Those documents supersede any broader historical statement that assigns generic
server persistence to a private wrapper.

## Result

The historical statement “There is no hosted product database schema in this
repo” refers specifically to the Hasna cloud customer schema. The open package
does own the generic provider-neutral server schema and migrations required by
its public server, workers, queues, run records, artifacts, and conformance
contracts.

The current repo is the `@hasna/skills` package shape: CLI, MCP, generic
provider-neutral server and worker runtime, public migrations, skill corpus,
and reusable engine modules. Searches for SaaS schema ownership must not treat
generic public runtime tables or skill implementation details as Hasna customer
product state.

Database-related files that do exist are inside individual skills or examples,
such as:

- `skills/scaffold-project` templates.
- `skills/manageskill` local skill database helpers.
- `skills/managemcp` local skill database helpers.
- `skills/managehook` local skill database helpers.
- `skills/consolelog` local skill database helpers.
- `skills/database-explorer` skill runtime code.

Those are skill implementation details and must not be treated as hosted
service schema. This historical phrase also does not classify the generic
provider-neutral server schema as a Hasna SaaS schema.

## Open Package State

The open package may store local user state in files:

- Project config.
- Global config.
- Pins.
- Schedules.
- Run metadata.
- Logs.
- Exports.
- Feedback.

These local files are not account state and should not become a hosted database
model.

The public provider-neutral server may also persist generic account,
organization, session, API-key, registry, run, queue, artifact, migration,
capability, audit, and idempotency state. A provider-neutral schema may and, for
multi-user deployments, must support tenant isolation and authorization. It
must remain deployable without Hasna customer identity, commercial tenancy,
billing providers, domains, managed operations, or private infrastructure.

Tenant columns, scoped unique constraints, row-level access rules, membership
edges, and audit provenance are generic security primitives when they are
defined by public contracts and conformance tests. They become platform-owned
only when they encode Hasna customer topology, commercial entitlements, private
provider routing, or SaaS-specific operational policy.

## Hasna Cloud Composition State

The Hasna platform composition owns only its SaaS-specific schema and
extensions for:

- Hasna customer and commercial tenancy topology.
- Hasna-specific customer identity, invitation policy, organization rules, and
  API-access policy.
- Hasna billing, credits, entitlements, and commercial approvals.
- Moderation, support, and SaaS-specific registry policy.
- Private provider routing and SaaS-only runtime extensions.
- Platform operations and customer audit policy.

The older domain taxonomy called these areas Identity, API access, Skill registry,
Pins, Execution, Async jobs, Approvals, Billing, Connectors, and Audit. Under
the canonical contract, only their Hasna customer, commercial, or SaaS-specific
extensions are platform-owned; generic registry, execution, queue, and
connector contracts remain upstream.

The platform must import the generic server contracts and migrations rather
than duplicating their queues, workers, run state, or artifact protocol.
Composition-owned extensions should preserve tenant or organization ids,
idempotency keys, correlation ids, upstream package version, canonical skill slug, requested
skill slug, and source type such as upstream, private-hosted,
uploaded, or generated.

## Non-Goals

- Do not add hosted database requirements that are Hasna cloud-specific to the
  open package.
- Do not move generic provider-neutral server schema, queues, workers, shared
  contracts, or migrations into a platform-only wrapper.
- Do not use skill-local database helper code as hosted product state.
- Do not store remote account state in local CLI config.
- Do not let Hasna billing, customer tenancy, private operations, or SaaS web
  routes leak into public package exports.
