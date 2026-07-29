# Open Core Boundary

`hasna/skills` is the canonical open core. It owns the reusable skill engine,
bundled corpus, CLI, MCP server, public contracts, and package validation.

Private service wrappers such as your-server.example may wrap this package, but
their deployment-specific private service code must stay outside the npm package.

## Remotes

- `origin`: the public `hasna/skills` repository.
- Optional wrapper remotes: private products may keep their own remotes and
  cherry-pick generic engine changes back into clean public branches.

## Open-Core Changes

Changes belong in `hasna/skills` when they are useful without a private service
wrapper:

- CLI support for pointing at a compatible API origin, and for running with no
  API origin configured.
- Machine-readable `--json` output for CLI commands.
- MCP tool schema, registration, and transport improvements.
- Skill packaging, metadata, validation, and registry improvements.
- Project `.skills` state for local preferences, pins, schedules, runs,
  exports, logs, and metadata.
- Repo-native optional storage helpers for syncing `.skills` state through
  explicit `HASNA_SKILLS_*` database and object-storage envs.
- Public remote-run, pricing, discovery, and registry contracts.

## Private Service Wrapper Changes

These belong in a private service wrapper, not the open core:

- Account state, sessions, organizations, teams, and API key services.
- Billing, credits, ledgers, invoices, entitlements, and payment approval
  flows.
- Private server-executed skills, remote execution workers, queues, logs, artifact
  storage, and execution sandboxes.
- Admin dashboards, moderation queues, support tooling, analytics, and
  customer-specific workflows.
- Deployment infrastructure, secret stores, observability, alerting, and
  rollback automation.
- Production SaaS databases and artifact buckets, unless passed explicitly into
  open-core storage envs for a documented sync operation.

## Sync Rules

1. Preserve local-capable behavior for the open package.
2. Keep the API origin explicit through config and credentials. There is no
   deployment mode to select: with no origin configured, skills run on this
   machine, which is what makes non-interactive environments safe by default.
3. Expose reusable contracts from `src/index.ts` before wrappers depend on
   them.
4. Do not publish private service dependencies, protected source, or wrapper
   infrastructure in the public package.
5. Use `docs/architecture/upstream-sync.md` and the public-boundary preflight
   before moving wrapper work into the open repo.
6. Keep open-core storage envs (`HASNA_SKILLS_*`) separate from a wrapper's own
   `DATABASE_URL`; wrappers may map explicit storage envs, but must not pass
   their private SaaS database implicitly.
