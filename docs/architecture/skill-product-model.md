# Skill Product Model

skills.md treats a skill as a productized capability exposed through MCP,
versioned metadata, optional hosted source, execution policy, pricing,
moderation, and artifacts.

## Core Identity

Every skill needs stable identity fields:

- `id`: internal UUID.
- `slug`: globally unique public identifier, without `skill-` prefix.
- `display_name`: human-facing name.
- `description`: short marketplace summary.
- `long_description`: detailed docs or generated overview.
- `category`: marketplace category.
- `tags`: searchable tags.
- `owner_type`: platform, tenant, user, or upstream.
- `owner_id`: nullable for platform/upstream skills.
- `source`: upstream, hosted, uploaded, generated, or private.

The open `hasna/skills` package remains the upstream registry source. The SaaS
database stores synced metadata plus private/hosted additions.

## Visibility

Visibility controls who can discover and run a skill:

- `public`: visible in marketplace after moderation approval.
- `unlisted`: accessible by direct slug or team enablement link.
- `team`: visible to a tenant/team.
- `private`: visible only to the owner.
- `system`: platform-owned internal skill.

Visibility never grants execution by itself. Execution still checks tenant
membership, entitlement, approval policy, connector state, and spend limits.

## Execution Mode

Execution mode defines where code runs:

- `local`: bundled or explicitly owned source can run on the user's machine.
- `remote`: the Skills MCP exposes metadata and docs; server executes source.
- `hybrid`: local wrapper calls hosted APIs or workers.
- `connector_only`: no source execution; skill orchestrates connector actions.

Paid or untrusted hosted skills should default to `remote`. Local projects store
only pins, run records, exports, and logs. They do not receive remote
`SKILL.md`, manifests, scripts, or runtime folders. They receive outputs, not
protected source code.

## Source Policy

Source policy must be explicit:

- `downloadable`: full source can be downloaded only when policy explicitly
  allows it.
- `server_only`: source stays on skills.md workers.
- `redacted`: registry docs are public, implementation is hidden.
- `open_upstream`: source lives in `hasna/skills`.

The API must expose source policy before pin or run so agents can explain what
will happen.

## Versioning

Version fields:

- `version`: semantic version shown to users.
- `upstream_version`: version imported from `hasna/skills`, if applicable.
- `source_commit`: git SHA or archive digest.
- `content_hash`: hash of SKILL.md, manifest, and execution bundle.
- `published_at`: marketplace publish time.
- `deprecated_at`: nullable deprecation time.
- `replaced_by_skill_id`: nullable migration target.

Pinned skill records should pin a version/content hash so later updates are
explicit.

## Input Schema

Each executable skill should expose an input contract:

- `input_schema`: JSON Schema for accepted inputs.
- `cli_args_schema`: normalized command argument schema.
- `mcp_input_schema`: MCP tool schema generated from the same source.
- `requires_files`: whether file uploads or paths are expected.
- `requires_connectors`: connector slugs and permission scopes.
- `requires_approval`: default approval requirement.

Schema generation can be incremental, but the durable model should assume these
fields exist.

## Outputs And Artifacts

Executions can produce:

- `text`: plain output.
- `json`: structured output.
- `file`: downloadable file.
- `media`: image, audio, video, or document.
- `log`: execution logs.
- `webhook`: delivery event.

Artifacts need durable metadata: content type, byte size, checksum, storage key,
visibility, created_at, expires_at, and generated_by_execution_id.

## Pricing

Pricing model fields:

- `pricing_type`: free, credit_metered, subscription_included, paid_once, or
  external_quote.
- `credits_per_run`: nullable for non-credit pricing.
- `minimum_plan`: nullable plan requirement.
- `requires_payment_method`: boolean.
- `approval_required_above_cents`: nullable spend threshold.
- `refund_policy`: best-effort, automatic_on_failure, or none.

Billing checks happen server-side at run creation and again in workers before
expensive side effects.

## Moderation

Public and team-uploaded skills require moderation state:

- `moderation_status`: draft, pending_review, approved, rejected, suspended.
- `moderation_reason`: nullable reviewer note.
- `security_score`: nullable score from scans.
- `scan_status`: pending, passed, failed, skipped.
- `scan_findings`: structured finding list.
- `approved_by`: reviewer user id.
- `approved_at`: nullable timestamp.

Moderation status affects discoverability and execution eligibility.

## Pin Record

A pin is separate from a skill:

- `tenant_id`, `user_id`, `skill_id`, `version`, `content_hash`.
- `target`: cli, mcp, claude, codex, gemini, opencode, web, api.
- `scope`: user, team, or project.
- `agent_mcp_registration_id`: nullable pointer to the active MCP registration.
- `enabled`: boolean.
- `pinned_at`, `updated_at`, `unpinned_at`.

This lets the platform answer which skills are enabled for a project or team
without copying skill definitions into agent folders.

## Execution Record

An execution stores:

- Actor, tenant, skill, version, input hash, and idempotency key.
- Status: queued, running, waiting_for_approval, succeeded, failed, cancelled,
  expired, refunded.
- Runtime profile, queue name, worker id, duration, retries, and cost.
- Approval id, credit transaction id, connector ids, logs, and artifact ids.

Execution state is the source of truth for CLI, MCP, API, and web UI.
