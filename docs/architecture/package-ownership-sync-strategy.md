# Package Ownership And Sync Strategy

This strategy decides how `skills.md` consumes `hasna/skills` while preserving
one canonical owner for the open skill engine.

## Decision

Use `hasna/skills` as the canonical upstream package and consume it from the
private SaaS through package dependency plus generated registry sync.

Do not use git worktrees, submodules, subtree imports, or a permanent copied
source tree as the product integration model. Those approaches create two skill
engines that drift. The private SaaS should import stable package APIs and
store product state in its own PostgreSQL schema.

## Ownership

| Concern | Owner | Package/Repo | Notes |
| --- | --- | --- | --- |
| Skill engine APIs | Open upstream | `hasna/skills`, npm `@hasna/skills` | Registry, pinning, validation, docs, config, scheduler primitives, API types. |
| Agent CLI | Open upstream | `@hasna/skills`, command `skills` | Local for free/user-key skills; premium runs are remote-only through the hosted API. |
| MCP server | Open upstream | `@hasna/skills`, command `skills-mcp` | Agent protocol wrapper over shared engine APIs. |
| Bundled skill corpus | Open upstream | `hasna/skills/skills/*` | Source corpus for free and explicitly local execution; premium entries expose contracts, not private source. |
| SaaS API | Private product | `hasnatools/platform-skills` | Versioned HTTP API, auth, tenants, pins, runs, billing, approvals. |
| SaaS workers | Private product | `hasnatools/platform-skills` | Queues, sandbox execution, exports, logs, retries, connector bindings. |
| SaaS web app | Private product | `hasnatools/platform-skills` | Future web UI consuming the same API as CLI and MCP. |
| SaaS infrastructure | Private product | `hasnatools/platform-skills` | AWS, Terraform, PR previews, production release tags, observability. |

## Consumption Model

The production SaaS should consume `@hasna/skills` in this order of preference:

1. Released npm package pinned by lockfile.
2. Temporary git SHA dependency only while waiting for an upstream release.
3. Local file dependency only for short bootstrap work, never as the long-term
   production path.

The SaaS should use upstream APIs for:

- Registry enumeration and search seed data.
- Skill documentation and requirements extraction.
- Project pinning and remote/bundled registry metadata.
- Validation of uploaded, synced, and bundled skills.
- Shared API response types for CLI, MCP, SDK, and web clients.

The SaaS should not import upstream CLI or MCP internals directly. It should
call library APIs or hosted API endpoints so command and protocol surfaces stay
thin adapters.

## Premium Remote-Only Boundary

All premium skills must submit to the skills.md API from both CLI and MCP, and
must not fall back to bundled local execution. A missing, expired, or rejected
skills.md credential is a hard failure for premium runs, not a reason to run
private source on the user's machine.

The OSS package may expose public contracts for premium skills:

- name, display name, category, tags, and descriptions.
- public Skill.md usage documentation.
- input and output schemas.
- pricing and quote behavior.
- remote run, status, artifact, and receipt contracts.
- source-free stubs that explain hosted execution.

The OSS package must not expose private provider routing, worker code,
moderation internals, private prompts, model selection, hosted credentials,
SaaS queues, storage credentials, or private premium implementation source.

`SKILLS_API_KEY` authenticates the user to skills.md. It is not a model-provider
key and must be documented separately from provider keys such as `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or other skill-specific local
credentials. Free or explicitly local OSS skills may still read user-provided
environment variables and provider API keys when their public contract requires
local execution. Hosted premium skills should ask for the skills.md account
credential and keep provider keys server-side.

The public npm package must enforce this boundary at pack time. Hosted premium
skill package output may include `package.json`, public docs, schemas, pricing,
and source-free stubs, but must exclude `skills/<premium>/src` implementation
directories. Free and explicitly local OSS skills must keep their source and
documented user-provider API keys available.

## Bootstrap State

This repository now presents itself as the private
`@hasnatools/platform-skills` product while upstreamable engine improvements are
prepared separately for `hasna/skills`. The SaaS platform code consumes the
public engine through `@hasna/skills` and the `src/platform/upstream/skills.ts`
boundary module instead of importing copied local engine files directly.

Recommended transition:

1. Keep the `upstream` remote pointing to `hasna/skills`.
2. Finish upstream-compatible engine improvements as isolated commits.
3. Prepare upstream PRs or publish `@hasna/skills` releases for those generic
   commits.
4. Keep the private repo as a deployable SaaS workspace with the
   `@hasnatools/platform-skills` root package name.
5. Keep `@hasna/skills` as an external dependency for SaaS apps/packages.
6. Move product-only code into private apps and packages.

## Generated Registry Sync

The SaaS registry is PostgreSQL-owned. It should be populated from upstream
through an idempotent sync command, not by treating upstream files as the live
database.

Expected sync behavior:

1. Load upstream registry data from `@hasna/skills`.
2. Validate each skill directory or package artifact with upstream validators.
3. Normalize names, slugs, categories, tags, versions, docs, requirements, and
   source provenance.
4. Upsert into tenant/global registry tables with source version and git/npm
   provenance.
5. Preserve SaaS-only fields such as moderation state, pricing, visibility,
   owner, credit cost, and execution profile.
6. Emit a deterministic summary for CI and PR review.

The sync command should be safe to run in PR previews, local development, and
production migrations/seeds.

## Upstream Contribution Loop

When product work needs a generic engine change:

1. Implement the generic change without private imports or private path names.
2. Add focused upstream tests.
3. Run upstream gates: `bun run typecheck`, guarded `bun test`, and
   `bun run build`.
4. Run `bun run upstream:check`.
5. Push the private product commit to `origin/main`.
6. Prepare a clean upstream branch from `upstream/main` and cherry-pick only the
   generic commits.
7. Open or prepare the upstream PR.
8. After upstream release, update the SaaS lockfile to the released
   `@hasna/skills` version.

## Rejected Options

### Permanent Fork

A permanent fork would make the private repo the real skill engine. That blocks
open upstream improvements, complicates CLI/MCP publishing, and risks private
SaaS concerns leaking into reusable code.

### Git Subtree Or Submodule

Subtrees and submodules add operational friction without solving package
boundaries. The SaaS still needs released APIs, lockfile reproducibility, and a
database-owned registry.

### Generated Source Copy

Generating or copying upstream source into private packages hides ownership and
makes security review harder. Generated data is acceptable; generated source is
not the integration model.

### Monorepo Package Ownership Transfer

Moving `hasna/skills` into the private product monorepo would make the open
package depend on private product cadence. The open package should remain
independently buildable, testable, and publishable.

## Guardrails

- No private SaaS module should publish as `@hasna/skills`.
- SaaS modules must import upstream registry, docs, validation, and run-state
  APIs through `src/platform/upstream/skills.ts` or the released `@hasna/skills`
  package, not via `../../lib/*` copied-source paths.
- Until `@hasna/skills` publishes run-state helpers as package exports,
  `src/platform/upstream/skills.ts` may re-export the local compatibility
  helpers; product modules must still use the boundary module.
- No upstream module should require PostgreSQL, Stripe, AWS, tenants, or
  skills.md production configuration.
- No hosted or paid skill should download private source code onto the user
  machine.
- No web-only behavior should bypass the CLI/MCP/API contract layer.
- No sync step should mutate upstream skill source while running in production.
- No release should depend on unpinned package versions.

## Follow-On Work

- Add the registry sync command and tests.
- Rename or restructure the private root package before adding SaaS apps.
- Add exact dependency pinning and lockfile update policy for `@hasna/skills`.
- Document the upstream PR and npm release handoff once the first upstream PR is
  opened.
