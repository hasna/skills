# Open-Core Service Pattern

This pattern applies to `hasna/skills` and other open products that provide an
embedded local engine, an operator-owned server, and optionally a
Hasna-operated multi-tenant SaaS. The canonical mode, profile, adapter,
identity, data, and portability rules are in the
[Open Product Three-Mode Contract](open-product-three-mode-contract.md).

## Mode Correction

`local`, `selfhost`, and `cloud` describe runtime and operational ownership.
They do not describe a provider, account, region, hostname, or domain:

- `local` is the embedded engine.
- `selfhost` is an operator-owned deployment anywhere, including
  Hasna-internal infrastructure running in AWS.
- `cloud` is the Hasna-operated multi-tenant customer SaaS, when that product
  exists.

Open products always support local and self-hosted operation. Cloud is an
optional composition, not a requirement of the OSS core. Existing Open Skills
`self-hosted` setup flags are legacy compatibility behavior while the profile
contract is being implemented.

The public npm package is the install surface for both local and hosted users.
Installing `@hasna/skills` gives the client, not a SaaS backend. Published
`@hasna/skills@0.1.58` is SaaS-capable for supported skills, while
Hasna-internal infrastructure is a self-hosted deployment. Source, package, and
live API capability state can drift and must be verified separately. The
checked-in package/lock/source candidate is `0.2.0` and remains unreleased;
npm remains at `0.1.58` until a separate publish and tag.

## Package And Server Shape

- The public `@hasna/<name>` package owns the universal CLI, SDK, MCP client,
  embedded local engine, shared schemas, validation, docs, and local-safe
  defaults.
- The open repository also owns a provider-neutral self-hosted server and OCI
  distribution. It is self-hosted-aware, but remains useful without any remote
  account.
- The Hasna platform repository imports that OSS core and owns only the cloud
  composition: Hasna multi-tenant identity, billing, entitlement, operations,
  infrastructure, and commercial policy.
- The OSS package must not depend on the Hasna deployment, and the platform
  product must not fork or duplicate the OSS engine or shared API contracts.

Generic self-hosted auth, persistence, workers, queues, deployment contracts,
observability, and operator policy belong in the open server. Hasna-specific
tenant topology, billing providers, support tooling, and production operations
belong in the platform composition.

## Onboarding And Routing

- Do not prompt during package install.
- The bare CLI command prints discovery help and exits; interactive UI requires
  an explicit subcommand.
- Default to the built-in local profile. Select a remote authority through an
  explicit named profile.
- Resolve profiles in this order: `--profile`, product profile environment
  variable, project profile, global default, then local.
- Resolve the independent storage profile in this order: explicit storage
  selector, storage-profile environment variable, legacy storage environment
  bridge, selected deployment profile, project storage profile, global storage
  default, then local storage.
- Never silently phone home or fall back between local and remote execution.
- Never infer selfhost or cloud from an API URL, provider, or hostname.
- Never infer deployment mode or operation execution policy from storage mode;
  `local | remote | hybrid` is a separate package-storage axis.

## Universal Client Surface

The same commands operate through the embedded local adapter or the common HTTP
adapter selected by a profile. Appropriate OSS commands include:

- `profile list|show|set|remove|use` and `doctor --profile`
- `auth login`, `auth logout`, `auth whoami`
- `billing status`, `billing checkout`, `billing portal`
- `credits buy`
- registry, quote, run status, logs, artifact, export, import, and sync commands

Commands return stable JSON and store only scoped credential references in
configuration. The HTTP adapter discovers capabilities without credentials,
then verifies the signed response against an externally enrolled cloud identity
or selfhost fingerprint. Discovery is not a trust root. Product, operator,
service identity, mode, issuer, audience, tenant, features, and billing
capabilities must match before the client releases credentials.

Do not put these Hasna SaaS concerns in OSS:

- Hasna Stripe webhook handlers, price enforcement, ledgers, or customer records
- Hasna OAuth provider secrets or callback ownership
- Hasna tenant database topology or entitlement source of truth
- protected prompts, private provider routing, production credentials, or Hasna
  deployment automation

The open server may provide generic hooks and interfaces for those concerns,
but must remain independently deployable without them.

## Web App

The self-hosted web app is the account and billing source of truth for an
operator-owned installation when that operator enables those capabilities. The
Hasna cloud app is the corresponding source of truth for its customer tenant.
Both expose supported login, approval, API key, organization, run, artifact,
audit, and optional billing views over the same versioned APIs used by CLI and
MCP.

The source of truth is therefore the selected, verified profile authority—not a
particular hostname or Hasna's infrastructure.
