# hasna/skills Module Audit

This audit defines how hosted wrappers should reuse `hasna/skills` while
keeping the open package generic, local-first, and useful without private cloud
infrastructure.

## Executive Decision

Keep `hasna/skills` as the upstream engine and source corpus. Build hosted
products as wrappers around stable upstream contracts instead of copying the
skill engine into a private-only product.

Hosted wrappers may depend on upstream package APIs, consume its `skills/`
corpus, and propose generic improvements back to `hasna/skills`. They must not
push private account state, billing systems, deployment code, hosted execution
secrets, or wrapper-specific product flows into upstream.

## Source Inventory

| Area | Path | Reuse Decision | Hosted Wrapper Role |
| --- | --- | --- | --- |
| Public package API | `src/index.ts` | Reuse directly | Import typed contracts from one package boundary. |
| Registry | `src/lib/registry.ts` | Reuse with small upstream improvements | Source bundled metadata and normalize remote registry records. |
| Remote registry client | `src/lib/remote-registry.ts` | Reuse and extend upstream | Let CLI/MCP read hosted registry endpoints without changing local defaults. |
| Installer | `src/lib/installer.ts` | Reuse pin-only mode | Write `.skills/project.json` pins and keep source-copy paths disabled. |
| Skill docs and metadata | `src/lib/skillinfo.ts` | Reuse with execution caveats | Render docs, requirements, generated env examples, and local metadata. |
| Validation | `src/lib/skill-validation.ts` | Reuse and strengthen upstream | Validate uploaded, bundled, and synced skills before publishing or execution. |
| Scheduler | `src/lib/scheduler.ts` | Reference only for hosted services | Good local scheduler semantics, but hosted scheduling needs server state and workers. |
| Config | `src/lib/config.ts` | Reuse for local agent config | Store API URL and local CLI/MCP preferences, not tenant state. |
| API types | `src/types/api.ts` | Reuse and expand upstream | Keep CLI/MCP/web responses machine-readable and SDK-friendly. |
| CLI | `src/cli/index.tsx` | Reuse as client surface | Add hosted commands and keep local-first commands intact. |
| MCP server | `src/mcp/index.ts` | Reuse as agent protocol surface | Wrap registry, pinning, run, validation, and session tools with stable JSON. |
| Local server | `src/server/serve.ts` | Demo/reference only | Not a production hosted backend. |
| Vite dashboard | `dashboard/` | Demo/reference only | Useful UX reference, not the future hosted web app. |
| Skill corpus | `skills/*` | Source corpus | Sync into hosted registry, validation, packaging, and remote execution. |
| Shared skill helpers | `skills/_common` | Reuse carefully | Promote stable helpers upstream; server workers can vendor by package import. |
| Workflows | `.github/workflows/*` | Reference only | Public CI/publish workflows are not hosted deployment pipelines. |

## Upstream Modules To Modify

These improvements belong in `hasna/skills` because agents benefit from them
even without the private SaaS:

- Remote registry support: keep `SKILLS_API_URL` and config-driven API URL
  support generic, tested, and optional.
- Project pinning: keep `.skills/project.json` as preferences only and keep
  source/manifest/agent-folder copy paths disabled.
- Validation: keep `parseSkillFrontmatter`, `validateSkillDirectory`, and
  `validateRegistryConsistency` comprehensive enough for package publishing,
  hosted registry ingestion, and local authoring.
- CLI JSON output: preserve machine-readable `--json` responses for pin,
  unpin, run, config, validate, schedule, and MCP registration flows.
- MCP JSON contracts: keep tools as wrappers over shared library APIs rather
  than parallel implementations.
- API response types: grow reusable types in `src/types/api.ts` before building
  private SDK or web clients.
- Public boundary automation: keep scripts and docs that make package ownership
  boundaries explicit.
- Skill corpus hygiene: fix package shape, metadata, docs, and source entry
  point issues in upstream when they are generic skill quality problems.

## Hosted-Only Modules To Build

These must live in the private product layer, not upstream:

- Account schema: users, teams, memberships, API keys, skill pins, execution
  logs, exports, audit logs, credits, and billing ledger.
- Hosted registry service: server-owned indexing, moderation status,
  categories, versions, ownership, publishing, and search.
- Remote execution service: queued jobs, worker sandboxes, connector injection,
  export upload, logs, idempotency, retries, and cancellation.
- Billing service: hosted checkout, customer portal, webhooks, credit grants,
  refunds, payment approval records, and test fixtures.
- Web app: future interface on the same API contracts as CLI/MCP.
- Agent API: versioned REST endpoints and MCP-facing endpoints under a hosted
  domain.
- Deployment: infrastructure, secret stores, previews, production deploys,
  smoke tests, rollback, and cleanup.
- Observability: structured logs, metrics, traces, queue dashboards, alerts,
  webhook delivery inspection, and security audit trails.

## Critical Caveats

`runSkill` is a local execution helper and must not become the hosted execution
engine for untrusted tenant uploads. The SaaS worker must execute skills in a
server-controlled sandbox with explicit inputs, resource limits, connector
bindings, secrets injection, export capture, and logs.

The local scheduler is file/config oriented. Hosted scheduling needs server
state, worker queues, account-level authorization, idempotency keys, and
observable job attempts.

The local dashboard and server are development/demo surfaces. They should not
be upgraded into the production web app; the production web app should consume
the same versioned API that CLI and MCP consume.

The CLI and MCP currently remain local-first. Hosted behavior should be
additive and explicit through API URL configuration, API keys, remote registry
metadata, and remote runs.

## Integration Pattern

1. Import upstream modules through `src/index.ts` or a published package API.
2. Sync bundled `skills/*` metadata into the hosted registry through a
   validation pipeline.
3. Store account pins in hosted state while never writing local agent skill
   manifests.
4. Route `skills run` and MCP run tools to the hosted API for remote skills.
5. Execute hosted skills only in server workers and persist logs, exports,
   status, duration, and credit transactions.
6. Keep local source execution available for upstream/local skills but make the
   hosted path the default for SaaS-pinned skills.
7. Add web UI later as a first-class API client, not as a separate backend.

## Test Expectations

Every upstream-compatible module change needs focused upstream tests and full
package gates:

```bash
bun run typecheck
bun test
bun run build
```

Every hosted wrapper change needs service-level tests in that wrapper:

```bash
bun run test
bun run test:e2e
bun run build
```

Payment sandbox work belongs in the hosted wrapper and must verify checkout,
webhooks, credit grants, failed payment behavior, and idempotent replay handling
without printing secrets.

## Non-Goals

- Do not rename `hasna/skills` or replace it with a private-only fork.
- Do not add private cloud packages, payment products, account-specific
  infrastructure, or private deployment assumptions to upstream-compatible
  modules.
- Do not install paid or hosted skill source code on the user's machine.
- Do not let the future web interface own behavior that CLI and MCP cannot use.
