# hasna/skills Module Audit

This audit defines how hosted wrappers should reuse `hasna/skills` while
keeping the open package generic, local-first, and useful without private cloud
infrastructure.

## Historical status

This module audit predates the portable-server decision and is retained as
historical context. The current canonical ownership rules are
[Open Product Three-Mode Contract](open-product-three-mode-contract.md) and
[Package Ownership And Sync Strategy](package-ownership-sync-strategy.md).
Where this audit's older “hosted wrapper” wording is broader, those contracts
take precedence.

## Executive Decision

Keep `hasna/skills` as the upstream engine and public skill corpus. Build hosted
products as wrappers around stable upstream contracts instead of copying the
skill engine into a private-only product.

Hosted wrappers may depend on upstream package APIs, consume its local skill
source and hosted skill metadata, and propose generic improvements back to
`hasna/skills`. They must not push private account state, billing systems,
deployment code, hosted execution secrets, SaaS-specific worker extensions, or
wrapper-specific product flows into upstream. Generic server, worker, queue,
contract, and migration code remains upstream.

## Source Inventory

| Area | Path | Reuse Decision | Hosted Wrapper Role |
| --- | --- | --- | --- |
| Public package API | `src/index.ts` | Reuse directly | Import typed contracts from one package boundary. |
| Registry | `src/lib/registry.ts` | Reuse with small upstream improvements | Source bundled metadata and normalize remote registry records. |
| Remote registry client | `src/lib/remote-registry.ts` | Reuse and extend upstream | Let CLI/MCP read hosted registry endpoints without changing local defaults. |
| Installer | `src/lib/installer.ts` | Reuse pin-only mode | Write `.skills/project.json` pins and keep source-copy paths disabled. |
| Skill docs and metadata | `src/lib/skillinfo.ts` | Reuse with execution caveats | Render docs, requirements, generated env examples, and local metadata. |
| Validation | `src/lib/skill-validation.ts` | Reuse and strengthen upstream | Validate uploaded, bundled, and synced skills before publishing or execution. |
| Scheduler and queues | `src/lib/scheduler.ts`, public server/worker APIs | Reuse and extend upstream | Generic scheduling, queue, idempotency, and worker contracts belong to the provider-neutral runtime; compositions supply operator policy and infrastructure. |
| Config | `src/lib/config.ts` | Reuse for local agent config | Store API URL and local CLI/MCP preferences, not tenant state. |
| API types | `src/types/api.ts` | Reuse and expand upstream | Keep CLI/MCP/web responses machine-readable and SDK-friendly. |
| CLI | `src/cli/index.tsx` | Reuse as client surface | Add hosted commands and keep local-first commands intact. |
| MCP server | `src/mcp/index.ts` | Reuse as agent protocol surface | Wrap registry, pinning, run, validation, and session tools with stable JSON. |
| Provider-neutral server | `src/server/*`, `migrations/*` | Reuse and extend upstream | Ship generic server, worker, queue, storage, migration, capability, and conformance behavior without Hasna commercial dependencies. |
| Skill corpus | `skills/*` | Public corpus | Local OSS skills keep source; hosted skills keep docs and metadata only. |
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
  point issues in upstream when they are generic local skill quality problems.

## Hosted-Only Modules To Build (historical label)

This historical heading now means Hasna-platform-only composition and
extensions. The following SaaS-specific concerns must live in the private
product layer, while generic provider-neutral runtime behavior stays upstream:

- Account schema: Hasna customer users, teams, memberships, API keys, commercial
  skill pins, platform-owned execution-log and export extensions, customer audit
  policy, credits, and billing ledger.
- SaaS registry composition: Hasna moderation, commercial visibility,
  entitlement, and customer-ownership extensions over the generic registry.
- SaaS execution composition: Hasna tenant authorization, commercial policy,
  private provider routing, operator credentials, and SaaS-specific sandbox
  extensions over the generic server, worker, queue, contract, and migration
  runtime.
- Billing service: hosted checkout, customer portal, webhooks, credit grants,
  refunds, payment approval records, and test fixtures.
- Web app: interface on the same API contracts as CLI/MCP.
- Agent API composition: Hasna tenant, billing, support, and commercial routes
  layered over the versioned generic REST and MCP-facing endpoints shipped by
  the OSS server.
- Deployment: infrastructure, secret stores, previews, production deploys,
  smoke tests, rollback, and cleanup.
- Platform observability: Hasna production traces, queue dashboards, alerts,
  webhook delivery inspection, and customer security-audit integrations over
  the OSS runtime's generic structured log and metrics contracts.

Generic run, log, export, artifact, REST, and MCP contracts remain upstream.

## Critical Caveats

`runSkill` is a local execution helper and must not become the hosted execution
engine for untrusted tenant uploads. The generic OSS worker provides a
server-controlled sandbox and defines the provider-neutral input,
resource-limit, connector, export, and log contracts. The SaaS composition
imports that runtime and adds Hasna tenant, commercial, private-provider, and
operational policy without forking it.

The local scheduler is file/config oriented. Server scheduling uses the OSS
provider-neutral server state, worker queues, idempotency, and observable job
contracts; a SaaS composition adds account-level authorization and commercial
policy.

The historical phrase “does not own the production web app or server backend”
applies only to the Hasna production web app and SaaS-specific backend
composition. The OSS package does own the generic provider-neutral server
backend. The production web app should consume the same versioned API that CLI
and MCP consume.

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
5. Execute hosted skills through the generic OSS server/worker contracts; add
   tenant authorization, private routing, and credit transactions in the SaaS
   composition.
6. Keep local source execution available for upstream/local skills but make the
   hosted path the default for SaaS-pinned skills.
7. Keep the web UI as a first-class API client in the hosted platform.

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
