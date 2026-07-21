# Package Ownership And Sync Strategy

This strategy defines how operator-owned selfhost deployments and the optional
Hasna cloud composition consume `hasna/skills` while preserving one canonical
owner for the open skill engine and universal client.

## Decision

Use `hasna/skills` as the canonical upstream package. The public
`@hasna/skills` install serves local, selfhost, and cloud users through one CLI,
SDK, and MCP client. The open repository owns the embedded engine and
provider-neutral server; the Hasna platform repository imports released public
APIs to compose the customer SaaS.

Do not use permanent forks, submodules, subtree imports, copied source trees, or
monorepo package ownership transfers as the product integration model. Those
approaches create duplicate engines that drift.

## Ownership

| Concern | Owner | Package/Repo | Notes |
| --- | --- | --- | --- |
| Skill engine APIs | Open upstream | `hasna/skills`, npm `@hasna/skills` | Registry, pinning, validation, docs, config, scheduler primitives, and API types. |
| Agent CLI | Open upstream | `@hasna/skills`, command `skills` | Universal client: local execution plus remote submission to an explicitly selected and verified selfhost or cloud profile. |
| MCP server | Open upstream | `@hasna/skills`, command `skills-mcp` | Agent protocol wrapper over shared engine APIs. |
| Bundled skill corpus | Open upstream | `hasna/skills/skills/*` | Source corpus for free and explicitly local execution; server-executed entries expose contracts, not protected source. |
| Provider-neutral server | Open upstream | `@hasna/skills` server, worker, and migration binaries plus public OCI image | Generic auth interfaces, account policy hooks, registry, runs, queues, artifacts, migrations, capabilities, and conformance. |
| Operator selfhost composition | The deploying operator | Operator manifests or wrapper | Operator identity, tenant policy, enabled auth/billing integrations, infrastructure, secrets, observability, and rollback. Hasna-internal infrastructure belongs in this row. |
| Hasna cloud composition | Hasna platform | Matching `platform-*` product | Multi-tenant customer identity, Hasna billing and entitlements, managed operations, support, and cloud-specific policy. |
| Hasna cloud infrastructure | Hasna platform | Private platform deployment configuration | Production topology, provider credentials, tenant isolation, observability, release, and rollback for the customer SaaS only. |

## Consumption Model

External selfhost compositions and the Hasna cloud platform should consume
`@hasna/skills` in this order of preference:

1. Released npm package pinned by lockfile.
2. Temporary git SHA dependency only while waiting for a public release.
3. Local file dependency only for short bootstrap work, never as the long-term
   production path.

Compositions should use public APIs for:

- Registry enumeration and search seed data.
- Skill documentation and requirements extraction.
- Project pinning and remote/bundled registry metadata.
- Validation of uploaded, synced, and bundled skills.
- Shared API response types for CLI, MCP, SDK, and web clients.

Compositions should not import upstream CLI or MCP internals directly. They
should call library APIs or the shared server contracts so command and protocol
surfaces stay thin adapters.

## Premium Remote-Only Boundary

All server-executed premium skills must submit from CLI and MCP to the API for
the selected, enrolled `selfhost` or `cloud` profile, and must not fall back to
bundled local execution. A missing, expired, mismatched, or rejected remote
credential is a hard failure, not a reason to run protected source on the
user's machine.

The OSS package may expose public contracts for server-executed skills:

- name, display name, category, tags, and descriptions.
- public usage documentation.
- input and output schemas.
- pricing and quote behavior.
- remote run, status, artifact, and receipt contracts.
- source-free stubs that explain remote execution.

The OSS package must not expose private provider routing, worker code,
moderation internals, private prompts, model selection, remote credentials,
queues, storage credentials, or protected server-side implementation source.

`SKILLS_API_KEY` is the current legacy remote credential input. It is not a
model-provider key and must be documented separately from provider keys such as
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or other skill-specific
local credentials. The target profile contract replaces a global key with a
credential reference scoped to enrolled product, origin, service fingerprint,
operator, issuer, audience, and tenant.

The OSS CLI may include remote client commands such as `skills auth login`,
`skills billing status`, `skills billing checkout`, `skills billing portal`,
and `skills credits buy`. Those commands are adapters over shared HTTP APIs.
They must not contain Stripe keys, webhook handlers, entitlement ledgers,
tenant database logic, Hasna auth servers, or cloud worker execution logic.

Target deployment modes are `local`, `selfhost`, and optional `cloud`.
`self-hosted`, `hosted`, `remote`, `skills.md`, API origins, and global keys are
legacy inputs to the deterministic migration below; they never determine target
mode without trust enrollment.

## Legacy-To-Target Mapping

Migration keeps deployment authority, operation execution, and storage authority
as independent axes:

| Legacy source | Target representation | Migration rule |
| --- | --- | --- |
| `mode=local` or `skills setup --mode local` | Built-in `local` deployment profile | Deterministic; no remote enrollment or credential. |
| `mode=self-hosted`, `hosted`, `remote`, or `skills.md` | Pending remote deployment profile | Ambiguous until enrollment proves `selfhost` or `cloud`; the legacy spelling and origin do not decide. |
| `SKILLS_API_URL` or configured `apiUrl` | Deployment profile `origin` candidate | Normalize, then verify against enrolled product/operator/service identity before use. |
| `SKILLS_API_KEY` or saved legacy API key | `credentialReenrollmentRequired` plus a future credential reference | Never copy into a new scope. Re-enroll after product, fingerprint, operator, issuer, audience, and tenant verification. |
| `HASNA_SKILLS_STORAGE_MODE` / `SKILLS_STORAGE_MODE` | Storage profile `mode` (`local`, `remote`, or `hybrid`) | Keep independent from deployment mode and operation execution. Package-owned name wins. |
| `HASNA_SKILLS_DATABASE_*` / `SKILLS_DATABASE_*` | Storage database fields or environment-backed references | Preserve names, selected precedence, SSL/schema settings, and secret references without printing values. |
| `HASNA_SKILLS_S3_*` / `SKILLS_S3_*` | Storage object-store fields or environment-backed references | Preserve bucket/prefix/region/endpoint/path-style and credential references. Package-owned name wins. |
| Premium run behavior | Operation policy `remote-only` | Use the selected verified remote deployment profile; never infer storage or silently fall back. |

The canonical deterministic algorithm, two-minor-release dual-read window,
credential re-enrollment, downgrade eligibility, exit criteria, and rollback
rules are defined in the
[Open Product Three-Mode Contract](open-product-three-mode-contract.md#legacy-migration-contract).

## Generated Registry Sync

A compatible remote registry should be populated from upstream through an
idempotent sync command, not by treating upstream files as the live database.

Expected sync behavior:

1. Load upstream registry data from `@hasna/skills`.
2. Validate each skill directory or package artifact with upstream validators.
3. Normalize names, slugs, categories, tags, versions, docs, requirements, and
   source provenance.
4. Upsert into remote registry tables with source version and git/npm
   provenance.
5. Preserve composition-owned fields such as moderation state, pricing,
   visibility, owner, cost, and execution profile.
6. Emit a deterministic summary for CI and review.

## Upstream Contribution Loop

When a selfhost or cloud composition needs a generic engine change:

1. Implement the generic change without private imports or private path names.
2. Add focused upstream tests.
3. Run upstream gates: `bun run typecheck`, `bun test`, and `bun run build`.
4. Run the public-boundary preflight in strict marker mode.
5. Commit the generic change separately.
6. Publish or propose the change to `hasna/skills`.
7. Update remote compositions to the released package version.

## Rejected Integration Strategies

| Strategy | Why Rejected |
| --- | --- |
| Permanent Fork | Splits the public engine and makes public fixes slow to ship. |
| Git Subtree Or Submodule | Adds operational complexity while still coupling product and upstream histories. |
| Generated Source Copy | Makes imports and ownership unclear and risks publishing private code. |
| Monorepo Package Ownership Transfer | Moves the public package into product release concerns and confuses npm identity. |

## Guardrails

- No private composition module should publish as `@hasna/skills`.
- Composition modules must import upstream registry, docs, validation, and run-state
  APIs through released package APIs.
- No upstream client or embedded-engine module should require cloud account
  state, Hasna billing, customer tenancy, or private deployment infrastructure.
- No remote or paid skill should download protected source code into local
  agent folders.
- The public package must remain useful in local-only mode.
- The public package remains the universal client for selfhost and cloud; local
  usefulness must not be implemented by removing those client contracts.
