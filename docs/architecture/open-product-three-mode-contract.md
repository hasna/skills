# Open Product Three-Mode Contract

This document defines the target deployment and client contract for Open Hasna
products. It applies to `open-*` repositories and their universal
`@hasna/<name>` packages. Product-specific documents may add capabilities, but
must not redefine the mode names or infer a mode from infrastructure.

## Status

This is a target architecture, not a claim about the current implementation.
Open Skills currently makes the bare `skills` command non-interactive and
agent-first, but the three-mode routing, profile-aware authentication, common
adapter boundary, storage-profile resolver, and trust handshake described below
remain target contracts. Existing source behavior and published package
behavior are recorded separately in [Current Open Skills Status](#current-open-skills-status).

## Three Surfaces And Current Terminology

These surfaces are related, but they are not interchangeable:

| Surface | Meaning | Current status verified 2026-07-21 |
| --- | --- | --- |
| Public npm client | `@hasna/skills` is the universal CLI, SDK, MCP client, and local engine installed by users. It may call either a compatible self-hosted service or the Hasna SaaS. It does not install the Hasna SaaS backend. | The published `@hasna/skills@0.1.58` artifact is SaaS-capable for supported hosted skills: it includes hosted setup, authentication, billing, remote run, status, and export clients. |
| Hasna cloud | `skills.md` is the Hasna-operated, multi-tenant customer SaaS. This is what `cloud` means for Open Skills. | The public registry endpoint responded successfully during verification. Package metadata, source, and live API capability state can ship at different times and must be checked independently. |
| Internal self-hosted infrastructure | An operator-owned deployment is `selfhost` even when it runs in AWS or is operated by Hasna for internal use. | It is not the customer SaaS and must not be used as proof that the `cloud` product is available or ready. |

Current verification also found a release-synchronization blocker: the
`@hasna/skills@0.1.58` client reports `image`, `video`, and `music` as hosted
provider unavailable while the live `skills.md` registry reports those skills
available with different pricing metadata. The install is still a SaaS-capable
client; the disagreement means package, source, and API compatibility must be
reconciled before those skills are claimed to work end to end.

## Canonical Modes

Every open product has `local` and `selfhost` modes. `cloud` is optional and is
defined only when Hasna operates a multi-tenant SaaS for customers.

| Mode | Deployment authority | Operator |
| --- | --- | --- |
| `local` | Embedded in the CLI, SDK, or MCP process | The user or calling process |
| `selfhost` | A provider-neutral server deployed on infrastructure chosen by the operator | The customer, team, or another operator |
| `cloud` | The Hasna-operated, multi-tenant customer SaaS | Hasna |

`selfhost` describes ownership, not geography. An operator-owned deployment on
a laptop, another cloud, or Hasna-internal infrastructure in AWS is still
`selfhost`. A Hasna-operated customer SaaS is `cloud` even if it happens to use
the same infrastructure provider as a self-hosted installation.

A provider, account, region, cluster, origin, domain, or hostname never
determines the mode. Deployment mode is explicit profile metadata and is
verified against an enrolled service identity. Deployment mode is independent
from an operation's execution policy and from the `local | remote | hybrid`
storage axis.

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

## Independent Authority Axes

Clients resolve three independent decisions. None may silently set another:

1. **Deployment authority:** the selected profile declares `local`, `selfhost`,
   or `cloud` and identifies who operates the service.
2. **Operation execution:** each operation contract declares `local-only`,
   `remote-only`, or `either`; the selected deployment profile chooses the
   adapter only when the operation permits it.
3. **Storage authority:** a separate storage profile declares `local`, `remote`,
   or `hybrid` for package-owned runtime records, caches, snapshots, and
   artifacts.

A cloud profile may use a local cache. A local operation may use a separately
configured remote or hybrid storage profile. Neither case changes deployment
mode or authorizes remote operation execution. Diagnostic and operation results
report all three resolved axes.

## Deployment Profile Contract

Deployment profiles select a named runtime authority. A versioned profile has
the following logical fields:

```json
{
  "version": 1,
  "name": "team",
  "mode": "selfhost",
  "origin": "https://product.example.com",
  "tenant": "team-a",
  "credentialRef": "credential-store-reference",
  "storageProfile": "team-cache",
  "trust": {
    "enrollmentId": "enroll_01",
    "serviceFingerprint": "sha256:...",
    "expectedProduct": "skills",
    "expectedOperator": "example-team",
    "expectedIssuer": "https://identity.example.com",
    "expectedAudience": "skills-api",
    "expectedTenant": "team-a"
  }
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
  scoped by product, normalized origin, enrolled service identity, and tenant.
  Credentials must not be reused merely because two profiles share a hostname
  or mode.
- `trust` contains non-secret expectations established by enrollment. Discovery
  output may be compared with these fields, but it may not create or replace
  them.
- `storageProfile` is only a reference to an independently resolved storage
  profile. It does not change deployment mode or an operation's execution
  policy.
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

## Storage Profile Contract

Storage uses the existing `local | remote | hybrid` vocabulary and has its own
versioned schema:

```json
{
  "version": 1,
  "name": "team-cache",
  "mode": "hybrid",
  "localNamespace": "profiles/team",
  "databaseUrlRef": "env:HASNA_SKILLS_DATABASE_URL",
  "objectStoreRef": "env:HASNA_SKILLS_S3_BUCKET",
  "objectStoreCredentialRef": "credential-store-reference",
  "sync": {
    "direction": "local-to-remote",
    "conflictPolicy": "fail",
    "dryRunByDefault": true
  }
}
```

Storage-mode semantics are independent from deployment mode:

- `local`: package-owned local state is authoritative and no package storage
  sync occurs.
- `remote`: the configured remote store is authoritative; local material is a
  namespaced disposable cache unless an operation contract says otherwise.
- `hybrid`: the contract names one write authority plus an explicit sync
  direction and conflict policy. `hybrid` never means two implicit writable
  authorities.

Secret-bearing database URLs, object-store credentials, and session material
are references, not raw profile values. Bucket, prefix, region, schema, batch
size, and dry-run settings may be stored as non-secret configuration.

### Storage Selection Precedence

The storage profile is resolved independently in this exact order:

1. `--storage-profile <name>`
2. `HASNA_<APP>_STORAGE_PROFILE`
3. the legacy storage environment bridge, when any legacy storage variable is
   explicitly set
4. `storageProfile` on the selected deployment profile
5. the project storage profile
6. the global default storage profile
7. the built-in `local` storage profile

Within the legacy bridge, package-owned `HASNA_<APP>_*` variables win over
plain `<APP>_*` fallbacks. For Open Skills this preserves
`HASNA_SKILLS_STORAGE_MODE`, `HASNA_SKILLS_DATABASE_URL`, and
`HASNA_SKILLS_S3_*` ahead of `SKILLS_STORAGE_MODE`, `SKILLS_DATABASE_URL`, and
`SKILLS_S3_*`. `SKILLS_API_URL`, `SKILLS_API_KEY`, deployment mode, and the
selected operation never select storage mode.

## Execution Policy

Every operation declares one execution policy:

- `local-only`: reject non-local profiles.
- `remote-only`: require a verified `selfhost` or `cloud` profile.
- `either`: execute through the adapter selected by the resolved profile.

There is no silent fallback. A remote failure never causes local execution, and
a local failure never sends data to a remote service. An `either` operation
uses the chosen profile; it does not race or probe other modes. If a caller
wants a different authority, it selects another profile explicitly.

The operation result includes the resolved deployment profile, declared mode,
operation execution policy, adapter kind, resolved storage profile and mode,
and write authority in machine-readable metadata, without credential material.

## Enrollment, Capabilities, And Service Identity

Capabilities discovery is credential-free. Before sending an API key, token,
cookie, tenant identifier, or product data, the HTTP adapter may fetch a
versioned public discovery document over TLS. The request sends no
`Authorization` header or ambient credentials. A compatible service reports at
least:

- product and API contract identifiers plus supported version ranges;
- deployment mode and a stable service-instance identity;
- service operator identity and authentication issuer information;
- accepted authentication methods and credential audience;
- tenant model and the selected tenant's identity requirements;
- supported operations, feature flags, limits, and streaming transports;
- billing capability and whether it is absent, operator-managed, or
  Hasna-managed;
- server version, compatibility status, and request-correlation support.

The discovery document is untrusted input, not a trust root. Before accepting
it, the user or administrator enrolls an external trust anchor:

- A `cloud` profile is pinned to Hasna-signed product metadata rooted in a
  release key already trusted by the installed client. The signed record binds
  expected product, operator, origins, issuer, audience, tenant model, and
  service key or fingerprint.
- A `selfhost` profile is enrolled with an operator-supplied bundle or service
  fingerprint obtained through a separate authenticated channel. Copying a
  fingerprint from the discovery response itself is not enrollment.

The client verifies the discovery signature and chain against that enrolled
anchor, then compares normalized origin, service fingerprint, expected product,
operator, deployment mode, authentication issuer, credential audience, and
tenant binding with the profile. Only after every comparison succeeds may it
retrieve or transmit a credential. A `cloud` profile must identify the
Hasna-operated multi-tenant SaaS. A `selfhost` service must not claim cloud-only
identity or Hasna-managed billing. Capability absence is authoritative for
feature use, but capability presence never establishes identity or trust.

Trust rotation requires continuity proof signed by the previously enrolled key
and the replacement key, or a new externally verified enrollment bundle. A
changed origin, operator, issuer, audience, tenant, service fingerprint, or
unverified rotation fails closed with stable JSON diagnostics. The client never
auto-accepts a new identity from discovery; legitimate discontinuities require
explicit re-enrollment, and old credentials remain bound to the old identity.

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

The selected deployment profile owns product-operation side effects:

| Mode | Authoritative data |
| --- | --- |
| `local` | The profile's embedded local store |
| `selfhost` | The selected operator-owned service and tenant |
| `cloud` | The selected tenant in the Hasna SaaS |

Changing profiles changes authority; it does not merge state. Caches are
disposable, namespaced replicas and must be marked with their source identity
and freshness. Offline reads are allowed only where the operation contract
explicitly permits them and must report that they are cached.

The selected storage profile separately owns package runtime records, caches,
snapshots, and artifacts according to its `local | remote | hybrid` contract.
Selecting remote storage does not authorize a remote operation, and selecting a
cloud deployment does not force package storage to remote or hybrid. When an
operation produces server-owned state and client-owned artifacts, the result
identifies both authorities and their correlation identifiers.

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
7. **Migration:** translate legacy deployment and storage config into separate
   named profiles with a deterministic preview, credential re-enrollment, and a
   reversible backup; retain compatibility reads for the bounded window below.

## Legacy Migration Contract

The first stable release that writes versioned deployment and storage profiles
must implement `profile migrate --dry-run --json` and follow this deterministic
algorithm:

1. Read current configuration without mutation and record file paths, schema
   versions, source precedence, and a digest. Never print credential values.
2. Resolve legacy deployment inputs in their current precedence. Map explicit
   `local` to the built-in local deployment profile. Treat `self-hosted`,
   `hosted`, `remote`, `skills.md`, an API URL, or an API key as evidence of a
   legacy remote configuration only; they do not prove `selfhost` or `cloud`.
3. Require the user or administrator to choose and enroll the remote authority.
   Cloud enrollment must match the pinned Hasna cloud identity. Selfhost
   enrollment must match the operator's external bundle or fingerprint.
4. Create a credential reference only after enrollment. Do not copy an existing
   raw key into a new scope or reuse it across a changed product, origin,
   operator, issuer, audience, tenant, or service identity. Mark the profile
   `credentialReenrollmentRequired` until a newly scoped credential succeeds.
5. Resolve storage independently. Preserve every explicitly set
   `HASNA_SKILLS_STORAGE_*`, `HASNA_SKILLS_DATABASE_*`, and
   `HASNA_SKILLS_S3_*` variable, plus its plain `SKILLS_*` fallback, as an
   environment-backed reference or non-secret storage field. Preserve the
   existing package-owned-over-plain precedence and never reinterpret storage
   `remote` as deployment `cloud`.
6. Emit a stable plan containing proposed deployment profiles, storage profiles,
   unresolved enrollments, preserved variables, namespaces, conflicts, backup
   path, and rollback eligibility. The same inputs must produce the same plan.
7. On apply, write a versioned backup and digest first, then atomically write new
   config. Do not delete or rewrite legacy config during the compatibility
   window. A failed enrollment or write leaves the old parser and files active.

The dual-read compatibility window lasts for the first two consecutive minor
releases after stable profile writing ships. During that window:

- new profile config is authoritative when present;
- legacy deployment and storage values are read only when the corresponding new
  profile is absent;
- writes go only to the new format; there is no dual-write;
- every legacy read emits a stable deprecation code and a redacted migration
  plan reference;
- credentials continue using their legacy binding until re-enrollment, but are
  never silently promoted into the new profile.

Removing legacy reads requires all conformance fixtures, package upgrade and
downgrade tests, storage-variable preservation tests, enrollment and rotation
tests, and release notes naming the first unsupported legacy version to pass.
The release must also prove that a clean legacy config migrates, restarts, and
resolves the same deployment and storage authorities without credential or data
loss.

Downgrade is permitted only while the versioned backup exists and no
new-format-only mutation has occurred. Otherwise downgrade fails closed with an
export command and forward-repair instructions. Rollback restores the parser
and backup atomically; it never changes remote data, copies credentials, changes
storage authority, or redirects operations to another deployment.

## Conformance Matrix

| Contract | Local | Selfhost | Cloud |
| --- | --- | --- | --- |
| Bare command is non-interactive; JSON is stable | Required | Required | Required |
| Profile precedence and diagnostics | Required | Required | Required |
| Shared operation/result/error schemas | Required | Required | Required |
| No silent cross-mode fallback | Required | Required | Required |
| Local/common-HTTP adapter fixtures | Local adapter | HTTP adapter | HTTP adapter |
| Credential-free discovery plus externally anchored service identity | Not applicable | Required | Required |
| Tenant-scoped credential reference | Not applicable | Required when tenant-aware | Required |
| Independent `local | remote | hybrid` storage resolution | Required | Required | Required |
| Legacy storage variables preserved during migration | Required | Required | Required |
| Explicit export/import with provenance | Required | Required | Required |
| Provider-neutral server/OCI smoke | Not applicable | Required | Required as imported core |
| Multi-tenant Hasna billing and entitlement | Not applicable | Must not be assumed | Required when advertised |
| Upgrade and rollback rehearsal | Local schema | Server plus data | OSS core plus platform composition |

## Rollback

Profile migration follows the deterministic algorithm and dual-read window
above. A client rollback restores the versioned backup only when downgrade
eligibility is proven. A server rollback uses the documented image and schema
compatibility window; destructive schema changes require a forward repair
instead of pretending an older server can read them.

Cloud composition can roll back independently to the previous compatible OSS
release. Self-hosted operators retain the same ability with the public image.
Rollback never changes a profile's declared mode, reuses a credential with a
different service identity, or silently redirects operations to another
authority.

## Current Open Skills Status

Open Skills source has the universal npm package, local engine, CLI/MCP
surfaces, remote registry/run clients, provider-neutral server binaries, and
explicit local/self-hosted setup. Bare `skills` prints discovery help and exits
instead of entering an interactive UI.

The target architecture is not yet fully implemented:

- configuration has a single `mode` and `apiUrl`, not named versioned profiles;
- setup accepts `local` and `self-hosted` and rejects `cloud`;
- `SKILLS_API_URL` and `SKILLS_API_KEY` are global rather than profile-,
  service-, origin-, and tenant-scoped references;
- local and remote behavior do not yet share the adapter boundary specified
  here;
- there is no service identity/capabilities handshake;
- project/global profile precedence and `--profile` are absent;
- package storage already has independent `local | remote | hybrid` environment
  configuration, but it does not yet have named storage profiles or the target
  resolver and migration contract;
- data/cache/storage namespaces are not fully deployment- and storage-profile
  isolated;
- explicit cross-authority sync/export/import contracts are incomplete;
- some documentation calls the Hasna-operated endpoint “self-hosted”, which is
  legacy wording rather than the ownership definition in this contract.

Until those gaps close, operators and agents must treat current flags and
environment variables as legacy compatibility behavior and must not infer that
the three-mode safety guarantees already exist. They must also verify the exact
source commit, npm artifact, and live service capabilities independently; the
2026-07-21 package/API availability mismatch above is an active blocker, not
evidence that the npm package lacks a SaaS client.
