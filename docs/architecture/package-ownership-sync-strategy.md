# Package Ownership And Sync Strategy

This strategy defines how hosted wrappers consume `hasna/skills` while
preserving one canonical owner for the open skill engine.

## Decision

Use `hasna/skills` as the canonical upstream package and let hosted wrappers
consume it through released package APIs plus generated registry sync.

Do not use permanent forks, submodules, subtree imports, copied source trees, or
monorepo package ownership transfers as the product integration model. Those
approaches create duplicate engines that drift.

## Ownership

| Concern | Owner | Package/Repo | Notes |
| --- | --- | --- | --- |
| Skill engine APIs | Open upstream | `hasna/skills`, npm `@hasna/skills` | Registry, pinning, validation, docs, config, scheduler primitives, and API types. |
| Agent CLI | Open upstream | `@hasna/skills`, command `skills` | Local for free/user-key skills; hosted skills submit to explicit remote APIs. |
| MCP server | Open upstream | `@hasna/skills`, command `skills-mcp` | Agent protocol wrapper over shared engine APIs. |
| Bundled skill corpus | Open upstream | `hasna/skills/skills/*` | Source corpus for free and explicitly local execution; hosted entries expose contracts, not protected source. |
| Hosted API | Hosted wrapper | Separate private/service repo | Auth, account state, billing, approvals, registry sync, and runs. |
| Hosted workers | Hosted wrapper | Separate private/service repo | Queues, sandbox execution, exports, logs, retries, and connector bindings. |
| Hosted web app | Hosted wrapper | Separate private/service repo | Web UI consuming the same API contracts as CLI and MCP. |
| Hosted infrastructure | Hosted wrapper | Separate private/service repo | Deployment, secret stores, observability, and rollback automation. |

## Consumption Model

Hosted wrappers should consume `@hasna/skills` in this order of preference:

1. Released npm package pinned by lockfile.
2. Temporary git SHA dependency only while waiting for a public release.
3. Local file dependency only for short bootstrap work, never as the long-term
   production path.

Wrappers should use public APIs for:

- Registry enumeration and search seed data.
- Skill documentation and requirements extraction.
- Project pinning and remote/bundled registry metadata.
- Validation of uploaded, synced, and bundled skills.
- Shared API response types for CLI, MCP, SDK, and web clients.

Wrappers should not import upstream CLI or MCP internals directly. They should
call library APIs or hosted API endpoints so command and protocol surfaces stay
thin adapters.

## Premium Remote-Only Boundary

All hosted premium skills must submit to a compatible hosted API from both CLI
and MCP, and must not fall back to bundled local execution. A missing, expired,
or rejected hosted credential is a hard failure for hosted runs, not a reason
to run protected source on the user's machine.

The OSS package may expose public contracts for hosted skills:

- name, display name, category, tags, and descriptions.
- public usage documentation.
- input and output schemas.
- pricing and quote behavior.
- remote run, status, artifact, and receipt contracts.
- source-free stubs that explain hosted execution.

The OSS package must not expose private provider routing, worker code,
moderation internals, private prompts, model selection, hosted credentials,
queues, storage credentials, or protected hosted implementation source.

`SKILLS_API_KEY` authenticates the user to a hosted skills API. It is not a
model-provider key and must be documented separately from provider keys such as
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or other
skill-specific local credentials.

## Generated Registry Sync

A hosted registry should be populated from upstream through an idempotent sync
command, not by treating upstream files as the live database.

Expected sync behavior:

1. Load upstream registry data from `@hasna/skills`.
2. Validate each skill directory or package artifact with upstream validators.
3. Normalize names, slugs, categories, tags, versions, docs, requirements, and
   source provenance.
4. Upsert into hosted registry tables with source version and git/npm
   provenance.
5. Preserve hosted-only fields such as moderation state, pricing, visibility,
   owner, cost, and execution profile.
6. Emit a deterministic summary for CI and review.

## Upstream Contribution Loop

When hosted work needs a generic engine change:

1. Implement the generic change without private imports or private path names.
2. Add focused upstream tests.
3. Run upstream gates: `bun run typecheck`, `bun test`, and `bun run build`.
4. Run the public-boundary preflight in strict marker mode.
5. Commit the generic change separately.
6. Publish or propose the change to `hasna/skills`.
7. Update hosted wrappers to the released package version.

## Rejected Integration Strategies

| Strategy | Why Rejected |
| --- | --- |
| Permanent Fork | Splits the public engine and makes public fixes slow to ship. |
| Git Subtree Or Submodule | Adds operational complexity while still coupling product and upstream histories. |
| Generated Source Copy | Makes imports and ownership unclear and risks publishing private code. |
| Monorepo Package Ownership Transfer | Moves the public package into product release concerns and confuses npm identity. |

## Guardrails

- No private or hosted wrapper module should publish as `@hasna/skills`.
- Hosted modules must import upstream registry, docs, validation, and run-state
  APIs through released package APIs.
- No upstream module should require hosted account state, billing, tenants, or
  private deployment infrastructure.
- No hosted or paid skill should download protected source code into local
  agent folders.
- The public package must remain useful in local-only mode.
