# Open Core Boundary

`hasna/skills` is the canonical open core. It owns the reusable skill engine,
bundled corpus, CLI, MCP server, public contracts, and package validation.

## Historical status

This boundary note predates the portable-server decision and is retained as
historical context. The current canonical ownership rules are
[Open Product Three-Mode Contract](open-product-three-mode-contract.md) and
[Package Ownership And Sync Strategy](package-ownership-sync-strategy.md).
Those documents supersede any older wording that treats the entire remote
runtime as private wrapper code.

Self-hosted services such as skills.hasna.xyz may wrap this package, but their
deployment-specific private service code must stay outside the npm package.

## Remotes

- `origin`: the public `hasna/skills` repository.
- Optional wrapper remotes: private products may keep their own remotes and
  cherry-pick generic engine changes back into clean public branches.

## Open-Core Changes

Changes belong in `hasna/skills` when they are useful without a private self-hosted
service:

- CLI support for self-hosted-aware setup, local-only setup, and compatible API
  endpoints.
- Machine-readable `--json` output for CLI commands.
- MCP tool schema, registration, and transport improvements.
- Skill packaging, metadata, validation, and registry improvements.
- Project `.skills` state for local preferences, pins, schedules, runs,
  exports, logs, and metadata.
- Repo-native optional storage helpers for syncing `.skills` state through
  explicit `HASNA_SKILLS_*` database and object-storage envs.
- Public remote-run, pricing, discovery, and registry contracts.
- Generic provider-neutral server, worker, queue, contract, and migration code,
  including the public OCI runtime and conformance behavior.

## Self-Hosted Service Changes (historical label)

These belong in an operator selfhost or Hasna cloud composition, not the open
core:

- Account state, sessions, organizations, teams, and API key services.
- Billing, credits, ledgers, invoices, entitlements, and payment approval
  flows.
- Protected skill implementations, private prompts and provider routing,
  operator credentials, composition-owned storage credentials, and
  SaaS-specific worker or sandbox extensions. Generic workers, queues, shared
  run/log/artifact contracts, and migrations remain in the open core.
- Admin dashboards, moderation queues, support tooling, analytics, and
  customer-specific workflows.
- Deployment infrastructure, secret stores, observability, alerting, and
  rollback automation.
- Production SaaS databases and artifact buckets, unless passed explicitly into
  open-core storage envs for a documented sync operation.

## Sync Rules

1. Preserve local-capable behavior for the open package.
2. Keep self-hosted mode explicit through config and credentials, with local-safe
   behavior for non-interactive environments.
3. Expose reusable contracts from `src/index.ts` before wrappers depend on
   them.
4. Do not publish private service dependencies, protected source, or self-hosted
   infrastructure in the public package.
5. Use `docs/architecture/upstream-sync.md` and the public-boundary preflight
   before moving wrapper work into the open repo.
6. Keep open-core storage envs (`HASNA_SKILLS_*`) separate from self-hosted service
   `DATABASE_URL`; wrappers may map explicit storage envs, but must not pass
   their private SaaS database implicitly.
