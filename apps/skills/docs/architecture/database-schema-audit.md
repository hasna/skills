# Database Boundary Audit

This audit documents the public package database boundary.

## Result

There is no hosted product database schema in this repo.

The current repo is the `@hasna/skills` package shape: CLI, MCP, local server
helpers, skill corpus, and reusable engine modules. Searches for hosted schema
ownership must not treat skill implementation details as product state.

Database-related files that do exist are inside individual skills or examples,
such as:

- `skills/scaffold-project` templates.
- `skills/manageskill` local skill database helpers.
- `skills/managemcp` local skill database helpers.
- `skills/managehook` local skill database helpers.
- `skills/consolelog` local skill database helpers.
- `skills/database-explorer` skill runtime code.

Those are skill implementation details and must not be treated as hosted
service schema.

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

## Hosted Wrapper State

Hosted wrappers, if built, own their own schema for:

- Tenancy.
- Identity.
- API access.
- Skill registry sync.
- Pins.
- Execution.
- Async jobs.
- Approvals.
- Billing.
- Connectors.
- Audit.

Hosted wrappers should preserve tenant or organization ids, idempotency keys,
correlation ids, upstream package version, canonical skill slug, requested
skill slug, and source type such as upstream, private-hosted, uploaded, or
generated.

## Non-Goals

- Do not add hosted database requirements to the open package.
- Do not use skill-local database helper code as hosted product state.
- Do not store hosted account state in local CLI config.
- Do not let hosted workers, billing, or web routes leak into public package
  exports.
