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

Self-hosted services such as operator.example may wrap this package, but their
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
- Generic authentication interfaces and implementations, API-key issuance and
  verification, account and organization primitives, provider-neutral tenant
  isolation, authorization hooks, and audit contracts needed by a compatible
  selfhost operator.
- Provider-neutral health, readiness, metrics, tracing, logging, backup,
  rollback, and opt-in selfhost deployment contracts. An operator can adopt or
  replace these without depending on Hasna infrastructure.

## Self-Hosted Service Changes (historical label)

These belong in the Hasna cloud composition, or in an operator composition when
an operator deliberately supplies its own non-portable policy; they are not OSS
core requirements:

- Hasna customer-account records, organization topology, tenant assignments,
  identity-provider configuration, and commercial API-key policy. Generic
  account, organization, session, auth, and API-key contracts remain upstream.
- Hasna billing, credits, ledgers, invoices, entitlements, payment approvals,
  price enforcement, and provider configuration. Generic optional billing
  interfaces and operator-supplied integrations may remain upstream.
- Protected skill implementations, private prompts and provider routing,
  operator credentials, composition-owned storage credentials, and
  SaaS-specific worker or sandbox extensions. Generic workers, queues, shared
  run/log/artifact contracts, and migrations remain in the open core.
- Hasna admin dashboards, moderation queues, support tooling, customer
  analytics, and customer-specific workflows.
- Hasna-managed production infrastructure, secret-store bindings,
  observability destinations, alert routing, rollback automation, and other
  private operational configuration. Provider-neutral contracts and opt-in
  selfhost examples remain upstream.
- Hasna production SaaS databases and artifact buckets. The generic server
  schema, tenant-isolation model, and storage adapters remain upstream.

## Sync Rules

1. Preserve local-capable behavior for the open package.
2. Keep self-hosted mode explicit through config and credentials, with local-safe
   behavior for non-interactive environments.
3. Expose reusable contracts from `src/index.ts` before wrappers depend on
   them.
4. Do not publish private service dependencies, protected source, Hasna-managed
   production configuration, or provider credentials in the public package.
5. Use `docs/architecture/upstream-sync.md` and the public-boundary preflight
   before moving wrapper work into the open repo.
6. Keep client-sync storage envs separate from the provider-neutral server's
   authoritative database and object-store namespace. A migration may read
   legacy names with explicit precedence, but it must not silently point client
   sync at an authoritative tenant/run/artifact database.
