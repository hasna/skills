# Sandboxed Execution And Credential Delivery — Decision Record

Status: substrate decision retained; delivery details updated 2026-09-15 by
[versioned cloud execution](./cloud-execution-runtime.md) and
[private corpus ownership](./corpus-policy.md). Unversioned built-in execution
is retired. The original decision was recorded 2026-08-23 and converged across the owner,
an SOL consult, the adversarial review, and research: the four lanes below are
the committed order of substrate, and the credential-delivery redesign in the
second half of this record is paired with it — the two were reviewed together
and neither lands without the other.

## Decision in one paragraph

Sandboxed skill execution runs on **ECS/Fargate per-run lanes FIRST**, reusing
the already-shipped `EcsDispatcher`; the E2B/Infinity lane is **SECOND**, as the
existing stub already reserves it; Cloudflare Workers is permitted **ONLY** as a
deliberate JS-only substrate and is not a general home for the corpus; WASM is
**rejected** as the primary mechanism. Credential delivery is redesigned in the
same change: per-run environment is an explicit ALLOWLIST, provider keys are
brokered host-side, the `SKILL_TEXT_API_KEY` duplication is retired, and
custom-skill intake is gated behind the sandboxed lane.

## Context

The SDK already owns the execution seam this decision plugs into:

- `src/sdk/dispatcher.ts` — the `Dispatcher` interface (submit/cancel); the
  execution lane bridges a server run record to it through
  `createSubmitRunService` (idempotent admission, in
  `src/sdk/execution/admission.ts`), which mints or reuses the run identity.
- `src/sdk/execution/dispatchers/ecs.ts` — a full Fargate implementation:
  CAS-claimed `attempt_id`/`lease_generation`, launch intent persisted before
  the ECS call, deterministic `clientToken` derived from `(run_id, attempt_id)`,
  lost-response reconciliation, and no concrete cluster/task-definition/subnet
  hard-coded — all infrastructure identifiers come from configuration.
- `src/sdk/execution/dispatchers/e2b.ts` — the E2B lane stub, typed and present,
  failing closed with `accepted: false` under the marker
  `E2B_LANE_STATUS = "e2b-lane-todo-infinity"`. Its own header records the
  plan: "Fargate RunTask first, E2B second".
- `src/sdk/execution/image-profile.ts` — immutable image profiles: a pinned
  runtime image (bun, node, or python3 at an exact version) plus an optional
  prebuilt dependency layer for allowlisted `system_deps`. Image digests and
  layer tags are deployment configuration, not code; an unpinned runtime or an
  unknown `system_deps` entry fails closed at admission.

The gap this decision closes: the ECS dispatcher and image-profile machinery
exist but are not yet the production route, and the credential-delivery path
that would feed a sandboxed lane still carries the duplication this record
retires.

## The four options, in the committed order

### 1. ECS/Fargate per-run lane — FIRST

One Fargate task per run, launched through the existing `EcsDispatcher`. Three
named work items make it production-shaped:

- **Supply runtime image digests and `system_deps` layer tags as deployment
  configuration.** `PinnedRuntime.imageDigest` is currently `null` until config
  supplies it; `ImageProfileRegistryConfig.dependencyLayers` maps the canonical
  `system_deps` key to the prebuilt layer tag. This decision commits that
  configuration as the delivery vehicle for the Fargate lane.
- **Build the bundle-by-digest supervisor.** Nothing is installed at execution
  time; the supervisor fetches the skill bundle by digest and runs it inside
  the pinned image. This preserves the image-profile invariant ("a launch never
  carries a guess") at the artifact level.
- **Route hosted runs through versioned admission.** The managed runtime binds
  the private published bundle, exact version and digest before dispatch. There
  is no unversioned host execution path, including for deterministic workloads.

Why first: it is the smallest delta to a fully-reviewed, already-shipped
dispatcher; it reuses the existing CAS/reconciliation guarantees; and it carries
the same per-run isolation without standing up a new substrate.

### 2. E2B/Infinity lane — SECOND

The stub already reserves this lane and its header already commits the order
("Fargate RunTask first, E2B second"). When built, it runs in credential-zero
boxes with egress fencing — the box never receives host credentials, matching
the fleet-wide infinity/e2b isolation model. It is the latency-sensitive
follow-up, not a replacement for lane 1.

### 3. Cloudflare Workers — ONLY as a deliberate JS-only substrate

Workers is accepted as a substrate only for workloads that are genuinely
JavaScript-only and benefit from its edge model. It is NOT a general home for
the corpus: workerd cannot host the bun-subprocess, ffmpeg, or ONNX
capabilities that a large part of the corpus exercises. Any Workers-based lane
must declare itself JS-only and must not be the routing target for skills that
need the heavier runtimes.

### 4. WASM — rejected as the primary mechanism

WASM is not the primary sandbox mechanism. The corpus spans bun subprocesses,
ffmpeg, and ONNX — none of which is a WASM guest — so a WASM-first design would
exclude the corpus it exists to run. Nothing in this record forbids WASM inside
a lane where a specific skill genuinely needs it; it is rejected as the
substrate decision.

## Credential delivery redesign (paired with the substrate decision)

The same record carries the credential-delivery decision because the review
treated the two as one change: a sandboxed lane is only as safe as what reaches
it.

- **Per-run environment is an explicit ALLOWLIST.** A run's environment may
  contain only the named allowed variables for that run. Prohibited by default:
  `DATABASE_URL`, AWS credentials, and provider API keys. The absence of an
  entry is the safe state; the allowlist is enforced at admission, not at
  launch.
- **Provider keys are brokered host-side.** A skill that needs a provider key
  does not receive the key in its environment. Delivery is either through a
  gateway proxy (the sandbox talks to the host-side gateway, which holds the
  key) or through per-run scoped delivery (a short-lived, run-scoped
  credential minted for exactly that run). Both forms keep the key off the
  per-run environment.
- **Stop the `SKILL_TEXT_API_KEY` duplication (`gatewayRunEnv`).** The same key
  currently reaches the run through two paths. The duplication is retired: one
  delivery path only, and it is the brokered one.
- **Custom-skill intake is gated behind the sandboxed lane.** A custom skill
  (user-supplied, unvetted code) is not executed on the host and is not
  admitted to any lane until the sandboxed lane exists and is the intake
  route. Intake gating is part of this decision, not a follow-up.

## Prerequisite: private corpus ownership

This record builds on the corpus-policy decision recorded in
[docs/architecture/corpus-policy.md](./corpus-policy.md). Skills are private
account data, outside the public software repository. A profile selects an
immutable published version; execution uses its verified bundle and declared
policy. The former built-in dual-runtime set is retired.

## Consequences

- The Fargate lane ships first; the E2B stub stays failing-closed until the
  infinity integration lands.
- The image-profile configuration (digests + layer tags) becomes required
  deployment configuration for the first lane.
- The per-run allowlist and host-side brokering are enforced at admission; any
  run whose environment asks for a prohibited variable is refused, never
  sanitised at launch.
- The runtime admits only explicitly reviewed published bundles. There is no
  built-in corpus or slug-based handler fallback.
- Custom-skill execution stays unavailable until the sandboxed lane is the
  intake route.
