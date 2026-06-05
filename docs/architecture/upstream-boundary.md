# Open Core Boundary

`hasna/skills` is the canonical open core. It owns the reusable skill engine,
bundled corpus, CLI, MCP server, public contracts, and package validation.

Hosted products such as skills.md may wrap this package, but their private
service code must stay outside the open repository and outside the npm package.

## Remotes

- `origin`: the public `hasna/skills` repository.
- Optional wrapper remotes: private products may keep their own remotes and
  cherry-pick generic engine changes back into clean public branches.

## Open-Core Changes

Changes belong in `hasna/skills` when they are useful without a private hosted
service:

- CLI support for hosted-aware setup, local-only setup, and compatible API
  endpoints.
- Machine-readable `--json` output for CLI commands.
- MCP tool schema, registration, and transport improvements.
- Skill packaging, metadata, validation, and registry improvements.
- Project `.skills` state for local preferences, pins, schedules, runs,
  exports, logs, and metadata.
- Public remote-run, pricing, discovery, and registry contracts.

## Hosted-Wrapper Changes

These belong in a hosted wrapper, not the open core:

- Account state, sessions, organizations, teams, and API key services.
- Billing, credits, ledgers, invoices, entitlements, and payment approval
  flows.
- Private hosted skills, remote execution workers, queues, logs, artifact
  storage, and execution sandboxes.
- Admin dashboards, moderation queues, support tooling, analytics, and
  customer-specific workflows.
- Deployment infrastructure, secret stores, observability, alerting, and
  rollback automation.

## Sync Rules

1. Preserve local-capable behavior for the open package.
2. Keep hosted mode explicit through config and credentials, with local-safe
   behavior for non-interactive environments.
3. Expose reusable contracts from `src/index.ts` before wrappers depend on
   them.
4. Do not publish private cloud dependencies, protected source, or hosted
   infrastructure in the public package.
5. Use `docs/architecture/upstream-sync.md` and the public-boundary preflight
   before moving wrapper work into the open repo.
