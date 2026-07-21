# Open Product Three-Mode Contract

This document defines the target deployment and client contract for Open Hasna
products. It applies to `open-*` repositories and their universal
`@hasna/<name>` packages. Product-specific documents may add capabilities, but
must not redefine the mode names or infer a mode from infrastructure.

## Status

This is a target architecture, not a claim about the current implementation.
The PR that introduced this document fixes the bare `skills` command so it is
non-interactive and agent-first, and documents the target contract only.
Three-mode routing, profile-aware authentication, the common adapter boundary,
and the capabilities handshake described below remain unimplemented in Open
Skills. Existing `skills setup --mode local|self-hosted`, `SKILLS_API_URL`, and
`SKILLS_API_KEY` behavior remains the current compatibility surface.

## Canonical Modes

Every open product has `local` and `selfhost` modes. `cloud` is optional and is
defined only when Hasna operates a multi-tenant SaaS for customers.

| Mode | Runtime and data authority | Operator |
| --- | --- | --- |
| `local` | Embedded in the CLI, SDK, or MCP process, with local files or an embedded database | The user or calling process |
| `selfhost` | A provider-neutral server deployed on infrastructure chosen by the operator | The customer, team, or another operator |
| `cloud` | The Hasna-operated, multi-tenant customer SaaS | Hasna |

`selfhost` describes ownership, not geography. An operator-owned deployment on
a laptop, another cloud, or `hasna-xyz-infra` in AWS is still
`selfhost`. A Hasna-operated customer SaaS is `cloud` even if it happens to use
the same infrastructure provider as a self-hosted installation.

A provider, account, region, cluster, origin, domain, or hostname never
determines the mode. Mode is explicit profile metadata and is verified against
the service identity returned by a compatible remote service.

## Product And Repository Ownership

The public `@hasna/<name>` npm package is the universal client and local
product. One installation provides:

- the agent-first CLI;
- the typed SDK;
- the MCP server and schemas;
- the embedded local engine;
- the client for compatible `selfhost` and `cloud` services.

The commands and JSON contracts stay the same across profiles. A user can work
locally immediately, then select a profile to run the same operation against a
self-hosted service or the Hasna SaaS without installing another CLI.

The open repository owns:

- the universal CLI, SDK, and MCP client;
- the embedded local engine and local persistence adapters;
- a provider-neutral server distribution and OCI image;
- shared request, response, error, event, and capability schemas;
- migration tools, conformance fixtures, and operator documentation.

The matching platform repository owns only the Hasna SaaS composition. It
imports the OSS core and adds multi-tenant identity, Hasna billing and
entitlements, managed infrastructure, operations, support, and product-specific
SaaS policy. It must not fork or copy the OSS engine, shared API, or client
contracts.

Deployment manifests for a generic self-hosted server belong with the OSS
product. Hasna production manifests, tenant topology, private operational
configuration, provider credentials, and commercial policy belong in the
platform repository.

## One Client, Two Adapters

Business operations are expressed once in shared service contracts. The client
selects exactly one adapter after resolving a profile:

1. The local adapter calls the embedded engine directly and returns the shared
   response and error schemas.
2. The common HTTP adapter calls either a `selfhost` or `cloud` service. The
   profile changes origin, identity, tenant, and credentials; it does not select
   a different command implementation.

CLI commands and MCP tools are thin presentation layers over those adapters.
They must not implement separate billing, tenancy, execution, or persistence
rules. New operations are complete only when their local/remote support policy,
shared schemas, JSON output, and conformance fixtures are defined.

## Profile Contract

Profiles select a named execution and data authority. A versioned profile has
the following logical fields:

```json
{
  "version": 1,
  "name": "team",
  "mode": "selfhost",
  "origin": "https://product.example.com",
  "tenant": "team-a",
  "credentialRef": "credential-store-reference",
  "execution": "either"
}
```

Rules:

- `name`, `version`, and `mode` are required.
- `origin`, `tenant`, and `credentialRef` are invalid for a purely local
  profile unless a product explicitly defines a local peer service.
- `origin` is required for `selfhost` and `cloud`; only secure transport is
  accepted outside an explicit loopback development profile.
- A project config may contain a profile name and non-secret preferences. It
  must never contain a token, password, private key, session, or raw credential.
- Credentials live in an OS or package-owned credential store. A reference is
  scoped by product, normalized origin, verified service identity, and tenant.
  Credentials must not be reused merely because two profiles share a hostname
  or mode.
- Local state, remote caches, artifacts, and sync cursors are namespaced by
  profile and must never share writable storage accidentally.

### Selection Precedence

The selected profile is resolved in this exact order:

1. `--profile <name>`
2. `HASNA_<APP>_PROFILE`
3. the project profile
4. the global default profile
5. the built-in `local` profile

`<APP>` is the package-owned uppercase product identifier. Invalid, missing, or
incompatible profiles fail with a structured error that names the selected
source. An origin, API key, provider environment variable, or detected hostname
must not override this precedence or synthesize a mode.

## Execution Policy

Every operation declares one execution policy:

- `local-only`: reject non-local profiles.
- `remote-only`: require a verified `selfhost` or `cloud` profile.
- `either`: execute through the adapter selected by the resolved profile.

There is no silent fallback. A remote failure never causes local execution, and
a local failure never sends data to a remote service. An `either` operation
uses the chosen profile; it does not race or probe other modes. If a caller
wants a different authority, it selects another profile explicitly.

The operation result includes the resolved profile name, declared mode, adapter
kind, and data authority in machine-readable metadata, without credential
material.

## Capabilities And Service Identity Handshake

Before sending credentials or product data, the HTTP adapter performs a
versioned capabilities handshake over authenticated transport. A compatible
service reports at least:

- product and API contract identifiers plus supported version ranges;
- deployment mode and a stable service-instance identity;
- service operator identity and authentication issuer information;
- accepted authentication methods and credential audience;
- tenant model and the selected tenant's identity requirements;
- supported operations, feature flags, limits, and streaming transports;
- billing capability and whether it is absent, operator-managed, or
  Hasna-managed;
- server version, compatibility status, and request-correlation support.

The client verifies that the product, origin, service identity, mode, auth
audience, and tenant match the profile before retrieving or transmitting a
credential. A `cloud` profile must identify the Hasna-operated multi-tenant SaaS.
A `selfhost` service must not claim cloud-only identity or billing. Capability
absence is authoritative: the client does not infer features from routes,
hostnames, status codes, or provider metadata.

An incompatible API range, changed service identity, tenant mismatch, or
unverified auth issuer fails closed with stable JSON diagnostics. The user must
re-enroll the profile after a legitimate identity change.

## Agent-First CLI And MCP

The bare command prints compact command discovery and exits. Interactive UI is
always an explicit subcommand. Every operation intended for agents supports
stable `--json`; every remote-capable operation accepts `--profile`.

The common management surface is:

```text
<app> profile list|show|set|remove|use --json
<app> config get|set|list --json
<app> doctor --profile <name> --json
<app> <operation> --profile <name> --json
```

`profile set` validates non-secret fields and writes credential references, not
credential values, to configuration. `profile use` changes only the chosen
default at the requested scope. `doctor` shows precedence, resolved adapter,
storage namespaces, handshake compatibility, authentication state, tenant, and
capabilities with sensitive fields redacted.

MCP tools call the same SDK operations and accept the same profile selector.
They return structured data directly and never parse human CLI output.

## Data Authority And Portability

The active profile owns writes:

| Mode | Authoritative data |
| --- | --- |
| `local` | The profile's embedded local store |
| `selfhost` | The selected operator-owned service and tenant |
| `cloud` | The selected tenant in the Hasna SaaS |

Changing profiles changes authority; it does not merge state. Caches are
disposable, namespaced replicas and must be marked with their source identity
and freshness. Offline reads are allowed only where the operation contract
explicitly permits them and must report that they are cached.

Movement between authorities uses explicit `export`, `import`, or `sync`
commands. Such commands provide a dry-run plan, source and destination profile
identities, schema versions, counts, conflicts, irreversible effects, and an
idempotency key before mutation. They preserve provenance and audit records,
support resumable transfers, and never copy credentials. Continuous sync is an
operator-enabled feature with a named direction and conflict policy, not an
implicit side effect of selecting a profile.

## Compatibility And Versioning

- Shared API, event, capability, export, and error schemas are versioned in the
  OSS repository.
- Clients advertise a supported range; servers report a supported range; no
  overlap is a hard compatibility error.
- Additive capability changes are feature-gated. Breaking schema or semantic
  changes require a new contract version and migration notes.
- The local adapter and HTTP adapter run the same conformance fixtures.
- A newer server may not assume a newer client, and a newer client may not
  assume cloud-only capabilities from an older self-hosted server.
- Deprecations include machine-readable replacement and removal metadata.

## Security And Privacy

- Local mode performs no product-service network call unless the invoked
  operation explicitly names an external provider.
- Remote credentials are audience-, origin-, service-, and tenant-scoped,
  encrypted at rest, redacted from logs, and released only after identity
  verification.
- The server re-authorizes every operation from authenticated tenant state; it
  never trusts client-supplied tenant, role, price, entitlement, or approval.
- Exports are integrity-protected and exclude secrets by default. Imports
  validate schema, provenance, path safety, size limits, and tenant scope.
- `cloud` adds multi-tenant isolation, Hasna operational policy, billing, and
  support controls without weakening the OSS server's self-hosting boundary.
- Analytics are off by default in local mode. Remote service telemetry follows
  the operator's disclosed policy and is a reported capability.

## Observability

Every operation emits a correlation identifier and records the product,
contract version, profile name, declared mode, adapter, service identity, tenant
identifier or safe digest, and outcome. Logs never include credentials or raw
sensitive payloads. Local diagnostics remain local unless the user explicitly
exports them. Remote traces belong to the selected operator; cloud-specific
support integrations stay in the platform composition.

Health checks prove process health only. Readiness requires a successful
identity/capabilities handshake and checks for the dependencies needed by the
advertised operations. Clients expose both results through `doctor --json`.

## Deployment Contract

The OSS repository publishes a provider-neutral server and versioned OCI image.
It documents configuration, migrations, backup/restore, health/readiness,
horizontal scaling assumptions, and upgrade/rollback. It must run without
Hasna accounts, domains, billing, or infrastructure.

The platform repository pins and imports a released OSS version, composes the
Hasna-only multi-tenant services, and deploys the `cloud` product. Platform
composition is tested against the same capability and API conformance suite.
Provider choice remains deployment configuration and never enters client mode
selection.

## Adoption Stages

1. **Contract and discovery:** keep the bare command agent-first, publish this
   contract, and identify legacy mode/origin coupling.
2. **Profiles:** add the versioned profile schema, exact precedence, credential
   references, storage namespacing, and management/doctor commands.
3. **Adapters:** route existing local behavior through the local adapter and
   remote behavior through the common HTTP adapter with explicit execution
   policies and no fallback.
4. **Portable server:** publish the provider-neutral server/OCI image,
   capabilities endpoint, migrations, and operator guide.
5. **SaaS composition:** make the platform product import the OSS core and
   identify itself as `cloud`; keep commercial and tenant policy outside OSS.
6. **Conformance:** require the matrix below for releases, upgrades, imports,
   and rollback candidates.
7. **Migration:** translate legacy config into named profiles with a preview and
   reversible backup; retain explicit compatibility reads for one documented
   window.

## Conformance Matrix

| Contract | Local | Selfhost | Cloud |
| --- | --- | --- | --- |
| Bare command is non-interactive; JSON is stable | Required | Required | Required |
| Profile precedence and diagnostics | Required | Required | Required |
| Shared operation/result/error schemas | Required | Required | Required |
| No silent cross-mode fallback | Required | Required | Required |
| Local/common-HTTP adapter fixtures | Local adapter | HTTP adapter | HTTP adapter |
| Service identity and capabilities handshake | Not applicable | Required | Required |
| Tenant-scoped credential reference | Not applicable | Required when tenant-aware | Required |
| Explicit export/import with provenance | Required | Required | Required |
| Provider-neutral server/OCI smoke | Not applicable | Required | Required as imported core |
| Multi-tenant Hasna billing and entitlement | Not applicable | Must not be assumed | Required when advertised |
| Upgrade and rollback rehearsal | Local schema | Server plus data | OSS core plus platform composition |

## Rollback

Profile migration writes a versioned backup before changing configuration and
does not delete legacy config during the compatibility window. A client release
can disable new profile selection and restore the prior parser without changing
remote or local data. A server rollback uses the documented image and schema
compatibility window; destructive schema changes require a forward repair
instead of pretending an older server can read them.

Cloud composition can roll back independently to the previous compatible OSS
release. Self-hosted operators retain the same ability with the public image.
Rollback never changes a profile's declared mode, reuses a credential with a
different service identity, or silently redirects operations to another
authority.

## Current Open Skills Gaps

At the time this contract was added, Open Skills has the universal npm package,
local engine, CLI/MCP surfaces, remote registry/run clients, and explicit
local/self-hosted setup. The current PR also makes bare `skills` print discovery
help and exit instead of entering an interactive UI.

The target is not yet implemented:

- configuration has a single `mode` and `apiUrl`, not named versioned profiles;
- setup accepts `local` and `self-hosted` and rejects `cloud`;
- `SKILLS_API_URL` and `SKILLS_API_KEY` are global rather than profile-,
  service-, origin-, and tenant-scoped references;
- local and remote behavior do not yet share the adapter boundary specified
  here;
- there is no service identity/capabilities handshake;
- project/global profile precedence and `--profile` are absent;
- data/cache/storage namespaces are not fully profile-isolated;
- explicit cross-authority sync/export/import contracts are incomplete;
- some documentation calls the Hasna-operated endpoint “self-hosted”, which is
  legacy wording rather than the ownership definition in this contract.

Until those gaps close, operators and agents must treat current flags and
environment variables as legacy compatibility behavior and must not infer that
the three-mode safety guarantees already exist.
