# Reusable Skills Engine

This package stays useful as `hasna/skills` without requiring the private
skills.md SaaS app. Generic engine behavior must remain local-first, tested,
and documented so private platforms can wrap it without forking the core agent
contracts.

## Engine Contracts

### Local Registry

The bundled registry in `src/lib/registry.ts` remains the default source of
truth. Local CLI, package API, dashboard server, and MCP behavior must work
without a hosted API.

### Remote Registry

Remote registry mode is opt-in through `SKILLS_API_URL`, project/global config
`apiUrl`, or explicit `RemoteRegistryOptions.apiUrl`.

The reusable remote helpers are:

- `getConfiguredApiUrl`
- `buildSkillsApiUrl`
- `parseRemoteRegistryPayload`
- `loadRemoteRegistry`

Remote payloads may be an array, `{ "skills": [...] }`, or `{ "data": [...] }`.
Parsed remote skills are normalized to local `SkillMeta` records with
`source: "remote"`.

### Project Pinning And Runtime State

The open engine must not copy skill definitions into a project or into
agent-native skill folders. Skill discovery comes from the configured remote
registry, with the bundled OSS registry as the offline fallback.

- `installSkill` writes a project pin to `.skills/project.json`.
- `installSkillSource` is a disabled compatibility boundary and must return an
  error instead of copying source.
- `createLocalSkillManifest` derives a manifest from a local bundled skill.
- `installSkillManifest` is disabled for project writes; docs are served by the
  registry/API/MCP instead of being copied into `.skills`.

`.skills/` is runtime state only: optional `project.json`, `runs/`,
`exports/`, `tmp/`, and run-local logs/artifact metadata. There is no
`.skills/skills` directory.

### CLI JSON Contracts

Agent-facing commands must provide stable `--json` output for automation. JSON
responses should use objects or arrays with explicit fields, not styled text.
Error paths should also return machine-readable JSON when `--json` is set.

The current reusable JSON surfaces include:

- `config`
- `run`
- `pin` and `unpin` dry runs
- `schedule`
- MCP registration helpers
- self-update status
- `validate`

### Validation

Validation is centralized in `src/lib/skill-validation.ts`.

Reusable validators are:

- `parseSkillFrontmatter`
- `validateSkillDirectory`
- `validateRegistryConsistency`

Validation should report structured `issues` and `warnings`, not only strings.
Required checks cover package shape, package name consistency, bin command and
target safety, documentation presence, SKILL.md frontmatter, provenance source
fields, reserved or unsafe package files, registry/directory consistency, and
source entry point warnings. Issue and warning lists are sorted by code and
message so agents can compare validation output without depending on filesystem
iteration order.

### MCP And Agent Surfaces

MCP tools should be wrappers around the same registry, pinning, docs,
requirements, and validation contracts used by the CLI. Tool responses should be
machine-readable and stable enough for agents to compose without parsing human
output.

User-facing MCP preference tools use pin language: `pin_skill`,
`unpin_skill`, `pin_category`, and `list_pinned_skills`.

The MCP `validate_skill` tool must call `validateSkillDirectory` rather than
maintaining a separate validation implementation. Meta tools such as
`search_tools` and `describe_tools`, plus agent session tools such as
`register_agent`, `heartbeat`, `set_focus`, and `list_agents`, should return
structured JSON payloads.

The reusable engine exposes machine-readable MCP contracts from
`src/lib/mcp-contracts.ts`. `createMcpContractManifest` returns the stable tool
and MCP resource contracts, while `createSkillMcpMetadata` attaches per-skill
install/run schemas to skill detail resources. These contracts define JSON
schemas for discovery, pinning, validation, and execution without SaaS-specific
assumptions such as tenant state, billing providers, hosted domains, or product
database tables. Contract changes must include compatibility fixtures so agents
can detect accidental schema drift.

The MCP contract manifest must remain without SaaS-specific assumptions.

## Test Requirements

Every reusable engine change must include focused `bun:test` coverage and pass
the package gates:

```bash
bun run typecheck
bun test
bun run build
```

On Linux, run `bun test` through the configured memory guard or an equivalent
`systemd-run --user --scope` cgroup.

Coverage expectations:

- Registry changes: `src/lib/registry.test.ts` or a focused registry test.
- Remote API changes: `src/lib/remote-registry.test.ts`.
- Installer changes: `src/lib/installer.test.ts`.
- CLI JSON changes: `src/cli/cli.test.ts`.
- Validation changes: `src/lib/validation.test.ts`.
- Public exports: `src/index.test.ts`.
- Boundary or contract docs: doc guard tests in `src/lib/*test.ts`.

## Upstream Rule

Do not add private SaaS concepts to this engine contract. Tenant state,
PostgreSQL, Stripe, hosted execution workers, AWS infrastructure, and skills.md
deployment configuration belong in the private product layer.
