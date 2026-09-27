# Versioned cloud execution

The first isolated lane executes reviewed `pdf-generate` bundles. It accepts
`content` and optional `title`, and returns `document.pdf` and `document.html`.
An unreviewed bundle, arbitrary command arguments, URLs,
filesystem paths and provider credentials are refused. Instruction skills stay
context for the agent; loading context never creates a cloud execution.

## CLI

```sh
skills run --target cloud --input '{"content":"Hello from an exact skill version","title":"Proof"}' --wait --json pdf-generate@0.5.2
skills executions show <execution-id> --json
skills executions logs <execution-id> --json
skills executions artifacts <execution-id> --json
skills executions download <execution-id> document.pdf --output ./document.pdf
skills executions cancel <execution-id> --json
```

With managed CLI loading enabled, a skill name resolves to the exact selection
in the active profile or project/session lock. Local execution uses that verified
bundle; cloud execution binds the same authority, workspace, version and digest.
Instruction-only selections direct the caller to `skills load`. `--selection-profile`
and `--session` select existing profile/session bindings. No managed run falls
back to the authoring corpus. Explicit `--cached` reads use the bounded verified
cache; authentication or network errors never implicitly enable cached mode.

`--skill-version` is an alternative to `@version`. `--idempotency-key` makes a
submission retryable. Download refuses to overwrite a file and checks the
artifact's byte size and SHA256 before writing. Polling prints the durable run
identifier before waiting, so a timeout is recoverable. Cloud failures never
fall back to local execution. `--target local` cannot override server-owned
execution policy.

## API and persistence

The legacy `POST /runs/:slug` endpoint returns HTTP 410 with
`LEGACY_EXECUTION_RETIRED` before creating any run. The old worker marks queued
unversioned records failed with that code and produces no artifacts. Historical
run reads, logs, artifact downloads, and cancellation remain available. Neither
the inline-worker setting nor a familiar skill name can enable embedded
execution; new hosted executions enter through the versioned endpoint below.

`POST /skills/v1/executions/:slug` takes
`{version,input,idempotencyKey,bundleDigest?,workspaceId?}`; the usual standalone aliases are supported.
`GET /executions/:id`, `/logs`, `/artifacts`, and `/artifacts/:name` return the
execution receipt and outputs. `POST /executions/:id/cancel` confirms task stop
through the existing ECS dispatcher. Reads and writes require the corresponding
`runs:read`/`runs:write` scopes (`skills:read` permits reads); role labels do not
bypass scopes.

Migration `0008_skill_runtime.sql` adds `skills_runtime_jobs`. The same SQLite
or Postgres database stores the immutable admission, launch attempts, logs,
artifacts, terminal receipt, and exact input/bundle snapshot. Each mutation locks
one run aggregate. Admission also serializes by tenant, enforcing one active
execution per tenant, including simultaneous first submissions. Reusing an
idempotency key for different content returns 409. A five-second reconciliation
loop recovers persisted launch intents after restart. Missing/ambiguous ECS
observations do not cause another launch. Tasks observed stopped without a
completion are marked failed; abandoned active tasks are cancelled after 20 min.

The existing SDK freezes tenant, skill version, bundle digest, input digest,
image digest and limits. Its dispatcher persists intent before calling Fargate,
uses a deterministic client token, and reconciles ambiguous responses. The
runtime API bridges that SDK to immutable published skill versions.

## Supervisor and isolation

Build `Dockerfile.runtime` from the `apps/skills` directory. It pins Bun 1.3.14,
installs `pdf-lib` 1.17.1 from `runtime/bun.lock` at image-build time, and builds
the native Linux guard. No dependencies are installed during a run. Image
metadata is verified against the frozen image digest before fetching work;
AWS defines Fargate metadata `ImageID` as the pullable SHA256 image digest.
[Metadata contract](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4-fargate-response.html)

The supervisor receives a short-lived bearer token bound to one run, attempt,
lease generation and 20-minute deadline. It can only fetch that run's work and
report its result through `/runtime/:id/work` and `/runtime/:id/complete`.
These exact routes validate their own token before normal API-key authentication;
they grant no registry, publication, or unrelated-run access.

The supervisor verifies the compressed bundle digest and bounds archive parsing.
It extracts into a fresh directory, uses a fixed entrypoint and generated
arguments, and launches a child with an explicit environment. The child never
receives the callback token, database configuration, service credentials or
provider keys. The native guard drops groups and uid/gid to 65534, sets
`no_new_privileges`, applies resource limits and a seccomp filter that denies
network syscalls (including io_uring), namespace/mount operations and process
inspection. Filters survive exec and child creation. The supervisor enforces a
60-second wall deadline, 32 KiB per output stream, and 2 MB aggregate artifacts;
artifacts must be regular files with the expected names and verified digests.

This lane only executes independently reviewed exact bundle digests. Arbitrary
custom-code intake and provider/connector access require a separate policy and
brokered execution lane; adding a digest is an operator review decision.

## Deployment configuration

Create a dedicated Fargate task definition with:

- The supervisor image pinned by digest, matching its architecture.
- CPU 256 and memory 512 MB; `awsvpc` networking; no public IP.
- An image/logging execution role; **no task role** and no service secrets.
- A read-only root filesystem and a private writable `/tmp` volume.
- Root supervisor startup; the guard drops the skill child's identity.
- Egress from the supervisor only to its Skills API and required platform
  endpoints. The child independently has no network through seccomp.

The API task role requires narrowly scoped ECS RunTask/ListTasks/DescribeTasks/
StopTask and PassRole for the dedicated task definition's execution role.
Configure `HASNA_SKILLS_RUNTIME_CONFIG` as JSON with these fields:

```json
{
  "cluster": "<cluster>",
  "taskDefinition": "<immutable-task-definition-revision>",
  "containerName": "<supervisor-container>",
  "region": "<region>",
  "subnets": ["<private-subnet>"],
  "securityGroups": ["<runtime-security-group>"],
  "imageDigest": "sha256:<actual-image-digest>",
  "apiOrigin": "https://<reachable-skills-origin>/api/v1",
  "reviewedBundles": [{"slug":"pdf-generate","version":"0.5.2","sha256":"<reviewed-bundle-digest>"}]
}
```

`apiOrigin` includes the version prefix and must accept Skills-issued run-scoped
bearer tokens. If an upstream gateway separately authenticates fleet keys, use
the direct service origin for supervisor callbacks. Supply a vault-backed
`HASNA_SKILLS_RUNTIME_SIGNING_KEY` (at least 32 bytes); the existing
`HASNA_SKILLS_API_SIGNING_KEY` is the fallback. Never place a credential value
in this file, image, command line or deployment logs. Omitting runtime config
keeps the lane unavailable and opens no execution database.

The existing `deploy-skills` workflow publishes the runtime image from the exact
CI-passed main commit after the service deploy. Set the manifest's optional
`runtime_ecr_repository_url` (or repository variable `RUNTIME_ECR_REPOSITORY_URL`)
to the dedicated repository; absent configuration skips publication. The job
builds ARM64, runs the native guard self-test, rejects every HIGH/CRITICAL Trivy
finding before assuming the deployment role, and emits a digest receipt artifact.
The role needs push access to that dedicated repository. The image job does not
register or activate a task definition: configure a reviewed immutable task
revision and its receipt digest through the infrastructure deployment.

When activating an already published and reviewed runner, the second API rollout
can reuse its immutable image: manually dispatch `deploy-skills` on `main` with
`publish_runtime_image=false`. This skips only runtime image publication and
avoids pushing the same immutable source tag again. The API and worker still
build, pass the vulnerability gate, migrate and deploy normally. Automatic CI
triggered deployments and manual dispatches with the default `true` publish the
runtime image. The existing manifest must already pin the reviewed runner image
and task revision before the activation rollout.

The manifest may supply `web_environment` and `worker_environment` string maps.
Both permit `HASNA_SKILLS_S3_RUN_PREFIX`; only the web map additionally permits
`HASNA_SKILLS_RUNTIME_CONFIG`. The workflow rejects other keys and any override
that collides with an existing secret reference. Existing task environment is
preserved except for those explicitly named non-secret settings. Retain CHOWN, DAC_OVERRIDE, KILL,
SETUID and SETGID capabilities for the supervisor; other default capabilities
may be dropped. KILL lets the supervisor stop its child after dropping the
child to a different uid; DAC_OVERRIDE permits artifact reads and cleanup in
that child's private output directories. The API's existing signing secret is the runtime fallback.

## Server integration

The server composition root creates the optional runtime service once:

```ts
const runtime = await createRuntimeService({
  databaseUrl: config.databaseUrl,
  productStore: store,
  artifacts: artifactStorage,
});
```

After normal version-alias normalization, call
`handleRuntimeWorkerRequest(request, runtime)` before API-key authentication.
Return its response when non-null. After regular authentication and scope
checks, call `handleRuntimeApiRequest(request, principal, runtime)` and return
its response when non-null. Close `runtime.close()` on server shutdown when the
embedding host provides a shutdown lifecycle.

Schema parity's expected table list gains `skills_runtime_jobs`; the complete
SQLite table count is 20 when the profile migration 0007 is included. The optional
public client export is `CloudExecutionClient` from `lib/cloud-executions.ts`.

## Validation

Focused tests cover actual CLI transport, no redirect credential forwarding,
exact bundle admission, a real supervisor child, environment isolation,
idempotency conflict, digest tampering, route scopes, tenant isolation, quotas,
cancellation, immutable completion, stopped-task recovery, SQLite restart and
concurrent claims. `runtime-postgres.test.ts` runs the same storage invariants
against a fresh database when `HASNA_SKILLS_TEST_DATABASE_URL` is supplied.
The image build runs the native guard's network-denial/identity self-test.


## Versioned pure contract

`regex-test.v1` is a narrowly defined, credential-free interface for a reviewed
self-contained Bun executable. It does not execute arbitrary uploaded packages.
Input is exactly `{pattern,text,flags}`: pattern at most 512 UTF-8 bytes, text at
most 4096, total JSON at most 8192, unique JavaScript flags and no simultaneous
`u`/`v`. Unknown fields and duplicate JSON keys (including escaped keys) are
refused. The API does not compile or evaluate patterns.

The trusted adapter passes no skill arguments and supplies only
`SKILLS_INPUT_JSON` containing those values plus `format:"json"`. A successful
stdout must be one JSON object with `pattern`, `flags`, and `matches`; each match
has `match`, `groups` (strings/null), `namedGroups` (string map/null), and a UTF-16
`index` into the admitted text. The API and supervisor both validate the output.
Output caps are 16 KiB stdout and 8 KiB stderr; artifacts are forbidden.

An operator-reviewed pure `reviewedBundles` entry requires `slug`, `version`,
`sha256`, `tenantId`, `imageDigest` equal to the configured image, and
`executionContract:{id:"regex-test.v1",descriptorDigest,entrypoint,entrypointDigest}`.
The descriptor digest is the canonical SHA256 of `PURE_DESCRIPTOR` in the
runtime source. This binds the versioned adapter, input/output contract and
limits. Entry digest covers the exact entrypoint; bundle digest covers every
sibling file. The manifest must declare an executable Bun entrypoint and empty
runtime env; package dependencies and lifecycle scripts are refused.

Before adding an entry, independently review the entire bundle and prove it
under the exact image and architecture, including its descendant behavior.
Bun Worker compatibility must be demonstrated in that image; a library version
or local unguarded success is insufficient. Publishing, local execution grants,
and profile selection do not authorize cloud execution. Private admission
records and operational bundles remain in the owner's private storage.

`GET /skills/v1/executions/:slug/eligibility?version=1.0.0&bundleDigest=<sha256>`
checks visibility, tenant, exact review and bundle integrity without launching
or reconciling a task. A visible unreviewed version returns `eligible:false`;
other tenants cannot discover private versions. CLI `executions eligibility`,
MCP `cloud_skill_eligibility`, and SDK `CloudExecutionClient.eligibility` expose
this metadata. Eligibility describes reviewed configuration, not a live proof.
Pure POST submissions require both `workspaceId` and `bundleDigest`. The frozen
admission includes the contract identity. Reusing an idempotency key after its
contract or image changed refuses with 409 rather than rewriting the old run.
A new explicit key starts a new pure job, including after an image upgrade;
legacy PDF admissions retain their existing digest-tuple deduplication, contract
and output semantics.

The pure supervisor requires the Linux guard. It extracts a fresh bundle, does
not link PDF dependencies, disables automatic dependency installation and dotenv
loading, and constructs a new environment without supervisor credentials. The
guard closes inherited descriptors (including those above the new open-file
limit), drops child identity and denies networking and process-group escape.
Its monitor owns one child group, enforces a five-second wall deadline and
cleans up descendants on exit, cancellation and supervisor death. CPU limit is
five seconds per process; task cgroup limits remain 256 CPU units and 512 MiB.
Pure output files are limited to 16 KiB and never become artifacts.

Source support alone does not activate this lane. Deployment still requires a
new exact-image build/security review, the dedicated no-task-role/read-only-root
Fargate definition described above, API rollout, private tenant/bundle/entry/image
admission, and an independently reviewed bounded live proof. No operational
bundle, credential or admission record belongs in this public repository.
