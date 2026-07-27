# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

Seven counts in this file — the ones in [Derived counts](#derived-counts) — are
re-derived from the tree by `src/lib/claude-md.test.ts`, which fails when they drift.
**Every other number here is unguarded prose**, true when written and verified by hand.
Do not copy a number out of this file into a commit message, an issue, or another
document without re-deriving it; that is how the previous version of this file rotted.

## Build and Development Commands

```bash
bun install                        # Install dependencies
bun run build                      # Clean, then build 5 bins + the library + .d.ts
bun test                           # Run the whole suite (Bun native runner)
bun test src/lib/registry.test.ts  # Run a single test file
HASNA_SKILLS_TEST_TIMEOUT_MS=5000 bun test   # Override the 30s per-test timeout
bun run typecheck                  # tsc --noEmit
bun run dev                        # Run the CLI from source
bun run dev:watch                  # CLI with --watch
bun run dev:mcp                    # MCP server with --watch
bun run dev:server                 # HTTP API server with --watch
bun run dev:worker                 # Run queue worker with --watch
bun run migrate                    # Apply migrations to the configured database
bun run verify:release             # Release guard: packlist + boundary + content scans
```

CI (`.github/workflows/ci.yml`) runs typecheck → **build** → test → release guard, in
that order. The build must precede the test run: several guards scan the packed file
list, and `bin/`/`dist/` only exist after a build. Reversing the order makes those
guards certify a tree they never read. CI also stands up a Postgres service and sets
`HASNA_SKILLS_TEST_DATABASE_URL`: the store suite always runs against memory and
SQLite, and adds Postgres only when that variable points at a reachable server. The
skip is announced, not silent — `src/server/app.test.ts` prints `storeBackendNotices()`
so "passed against both backends" is never claimed on a run that tested one.

## What this repository is

`@hasna/skills` is a catalog of AI agent skills plus the machinery to discover, pin,
document, and run them. Four surfaces share one set of core modules:

- **CLI** (`skills`) — Commander + an Ink TUI.
- **MCP server** (`skills-mcp`) — the same capabilities over Model Context Protocol.
- **HTTP API server** (`skills-server`, `skills-worker`, `skills-migrate`) — a real,
  shipped service you can run yourself: a queue, a durable store, and `/api/v1/*`.
- **Library** (`@hasna/skills`, plus the `@hasna/skills/storage` subpath).

There is **one deployment story: you run it.** No *deployment* mode concept survives —
no `local`/`self-hosted`/`cloud` config key, no storage mode, no `--mode` flag, no
`mode` field in any server payload. "Running locally" is simply the absence of a
configured API origin. See [No deployment modes](#no-deployment-modes).

(Unrelated `mode`-named things do still exist and are not part of that cleanup:
`InstallMode` in `src/lib/installer.ts` labels a pin/source/manifest result, and
SQLite's `journal_mode` is a pragma. Neither describes a deployment.)

## Repository layout

```
src/
├── cli/
│   ├── index.tsx                 # Commander program; registers command groups, then parseAsync()
│   ├── commands/                 # Mostly one registrar per command group; runtime-mcp.ts
│   │                             # is a plain handler imported by runtime.ts, not a registrar
│   ├── components/               # Ink TUI (App, SearchView, SkillSelect, CategorySelect, …)
│   └── cli.*.test.ts             # CLI integration tests, split by area
├── mcp/
│   ├── index.ts                  # skills-mcp entry: stdio or Streamable HTTP
│   ├── server.ts                 # buildServer(): composition root, calls the 5 registrars
│   ├── http.ts                   # Streamable HTTP transport (127.0.0.1:8836 by default)
│   ├── discovery-tools.ts        # registrar
│   ├── operation-tools.ts        # registrar
│   ├── schedule-tools.ts         # registrar
│   ├── storage-tools.ts          # registrar
│   ├── resource-meta-tools.ts    # registrar + all 4 MCP resources
│   └── helpers.ts                # mcpJson()/mcpError() response shaping
├── server/
│   ├── index.ts                  # skills-server entry
│   ├── app.ts                    # Bun.serve fetch handler + /api/v1 dispatch + durability guards
│   ├── handlers.ts               # executeRun(): what a queued run actually does
│   ├── store.ts                  # createStore(): postgres | sqlite | memory
│   ├── sqlite-store.ts           # bun:sqlite backend (the zero-config default)
│   ├── database-url.ts           # Pure URL -> backend target resolution
│   ├── migrate.ts                # skills-migrate entry
│   ├── worker.ts                 # skills-worker entry
│   ├── auth.ts                   # Bearer API key -> ApiPrincipal
│   ├── artifact-storage.ts       # Artifact bodies: database column or S3
│   ├── redaction.ts              # Scrub credentials out of logs and error text
│   └── config.ts, registry.ts, rows.ts, types.ts, migrations-dir.ts, store-fixtures.ts
├── lib/
│   ├── registry-data/            # The SKILLS array, one file per category + index.ts
│   ├── registry.ts               # Registry loading, merging, caching, lookup
│   ├── registry-types.ts         # SkillMeta, SkillKind, SkillSource, CATEGORIES, BASIC_SKILL_NAMES
│   ├── installer.ts              # Project pins (source and manifest installs are disabled)
│   ├── project-state.ts          # .skills/project.json
│   ├── portable-skills.ts        # ~/.hasna/skills/installed/<name>/ corpus: scaffold, port, run
│   ├── skillinfo.ts              # Docs, requirements, env-var extraction, runSkill()
│   ├── config.ts                 # Config file + getDataDir()
│   ├── api-url.ts                # The only place an API origin is resolved
│   ├── content-scan.ts           # Guard: secrets, PII, private context, committed output
│   ├── infra-identifiers.ts      # Guard: no literal infra identifiers
│   ├── vendor-host-guard.ts      # Guard: no vendor endpoint defaults
│   ├── packlist.ts               # The real npm-packed file list, from the packager
│   └── …                         # search, discovery, scheduler, run-state, tool-primitives, …
├── types/api.ts
├── index.ts                      # Library entry
├── storage.ts                    # @hasna/skills/storage subpath entry
└── test-preload.ts               # Per-test throwaway data dir (see Hermetic tests)

skills/                           # The catalog: bare-named directories, no skill- prefix
├── _common/                      # Shared helpers, not a skill
├── pdf-generate/
├── read-image/
└── …

agent-skills/                     # Instruction-only fleet workflow skills. NOT the public
                                  # catalog, no registry entries, excluded from the package.
migrations/{postgres,sqlite}/     # One numbered migration per dialect, kept at parity
docs/{architecture,product,release}/  # Design docs, several of them test-asserted
scripts/                          # release-guard.ts + corpus/upstream drift checks
```

There is no `dashboard/` directory and no `src/server/serve.ts`.

### Derived counts

| Count | Value | Derived from |
|---|---|---|
| Catalog skills | 19 | `SKILLS.length` (`src/lib/registry-data/index.ts`) |
| Instruction-kind skills | 19 | `SKILLS` entries with `kind: "instruction"` |
| Categories | 17 | `CATEGORIES` (`src/lib/registry-types.ts`) |
| MCP tools | 37 | `tools/list` against a live `buildServer()` |
| MCP resources | 4 | `resources/list` + `resources/templates/list` (3 static + 1 template) |
| Published bins | 5 | `bin` in `package.json` |
| bun build invocations | 6 | the `build` script in `package.json` |

`skills/` holds those 19 catalog directories plus `_common`. The OSS catalog is
**declarative-only**: every shipped skill is `kind: "instruction"` (SKILL.md prose,
no `src/`). The executable skills (each with `src/`) were archived out of the public
package — see the archive note below. `CATEGORIES` still lists 17 categories even
though only 7 currently hold a skill, so a restored dev skill drops back into its
category without a schema change.

## Interfaces

### CLI — `src/cli/index.tsx`

Commander program named `skills`. `index.tsx` is thin: it declares global options,
registers the default `interactive` command, then `await import()`s one registrar per
command group from `src/cli/commands/` and calls `parseAsync()`. Event and webhook
commands come from the external `@hasna/events/commander` package.

Top-level commands, grouped by registrar:

| Registrar | Commands |
|---|---|
| `index.tsx` itself | `interactive`/`i` (the default command) |
| `install.ts` | `pin`, `unpin`, `pins`, `update`, `install` (deprecated), `remove` (deprecated) |
| `list.ts` | `list`/`ls`, `search`/`s`, `categories`, `tags` |
| `introspect.ts` | `info`, `show`, `docs`, `requires`, `validate`, `diff` |
| `tool-primitives.ts` | `tools` (`list`, `info`, `deps`, `validate`) |
| `init.ts` | `init`, `export`, `import` |
| `diagnostic.ts` | `doctor`, `test`, `env-check`/`check-env`, `setup-info`, `outdated` |
| `runtime.ts` | `quote`, `run`, `runs`, `exports`, `mcp`, `setup`, `self-update` |
| `completion.ts` | `completion` |
| `create-sync-config.ts` | `config`, `create`, `sync` (disabled legacy) |
| `portable-skills.ts` | `new`/`scaffold`, `port`/`add` |
| `schedule.ts` | `schedule` |
| `registry.ts` | `registry sync` |
| `auth.ts` | `auth`, `billing`, `credits` |
| `feedback.ts` | `feedback` |
| `storage.ts` | `storage` (`status`, `sync-plan`) |
| `@hasna/events` | `webhooks`, `events` |

**TTY detection.** `const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false)`
at the top of `index.tsx`. The default `interactive` command renders the Ink TUI when
that is true; when false it prints the compact basic-profile registry as one line of
JSON and exits 0. (It does not print help — piping `skills` gives you machine-readable
output.)

### MCP server — `src/mcp/`

`buildServer()` in `src/mcp/server.ts` is the composition root and calls five
registrars in order. Tool counts per registrar:

| Registrar | Tools |
|---|---|
| `discovery-tools.ts` | 9 |
| `operation-tools.ts` | 14 |
| `schedule-tools.ts` | 5 |
| `storage-tools.ts` | 2 |
| `resource-meta-tools.ts` | 8 (3 `registerTool` + 5 legacy positional `server.tool`) |

`resource-meta-tools.ts` also registers all MCP resources.

**Transports.** The `skills-mcp` binary defaults to **Streamable HTTP** on
`127.0.0.1:8836`; stdio requires `--stdio` or `MCP_STDIO=1`. Port precedence is
`--port <n>` → `MCP_HTTP_PORT` → 8836. The HTTP transport builds a fresh server per
request and closes it when the response closes, and exposes `GET /health`.

**Known wart — the agent-session tools are stateless over the default transport.**
`register_agent` / `heartbeat` / `set_focus` / `list_agents` share a `Map` that is a
local of `registerResourceMetaTools()`, so its lifetime is one `buildServer()`. Under
stdio that is the process; under the default HTTP transport it is *one request*. So
over HTTP, `register_agent` returns an id that is discarded immediately, `heartbeat`
and `set_focus` always answer `AGENT_NOT_FOUND`, and `list_agents` always returns
empty. Do not build on those four until the state is moved somewhere that outlives a
request.

### HTTP API server — `src/server/`

This **is** shipped in this repository. `bun run build` produces `bin/server.js`,
`bin/worker.js`, and `bin/migrate.js`, published as `skills-server`, `skills-worker`,
and `skills-migrate`. The `Dockerfile` runs `bun bin/server.js` and exposes 8787.

Routing is a hand-written dispatcher in `src/server/app.ts` — `handleApiV1` destructures
exactly four path segments after `/api/v1`.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness. Deliberately reports no deployment variant. |
| GET | `/ready` | |
| GET | `/api/auth/whoami` | Under `/api/auth`, not `/api/v1`. |
| GET | `/api/v1/skills` | |
| GET | `/api/v1/skills/:slug` | |
| GET | `/api/v1/skills/:slug/skill.md` | `text/markdown` |
| POST | `/api/v1/skills/:slug/quote` | |
| GET | `/api/v1/runs` | `?limit=` default 20, clamped to 100 |
| POST | `/api/v1/runs/:slug` | `:slug` is a **skill** slug. Enqueues, returns 202. Honours `idempotency-key`. |
| GET | `/api/v1/runs/:runId` | |
| GET | `/api/v1/runs/:runId/logs` | |
| GET | `/api/v1/runs/:runId/artifacts` | |
| GET | `/api/v1/runs/:runId/artifacts/:artifactId` | Streams the body as an attachment |
| POST | `/api/v1/runs/:runId/cancel` | |
| GET | `/api/v1/billing/status` | `{billingConfigured: false, code: "BILLING_NOT_CONFIGURED"}` — a capability statement, never a deployment name |
| GET | `/api/v1/billing/credits` | `{packs: []}` |
| POST | `/api/v1/billing/*` | `501 BILLING_NOT_CONFIGURED` |

Everything under `/api/` requires a bearer API key first (`401 AUTH_REQUIRED`).
Unmatched paths 404 — but note the dispatcher *ignores* a fifth and later segment
rather than rejecting it, so `/api/v1/skills/pdf-generate/skill.md/junk` still serves
markdown. Every JSON response carries `Cache-Control: no-store`. Org isolation is
enforced by `principal.orgId` predicates in the store layer.

Skill slugs are validated with `/^[a-z0-9-]+$/` (`isValidSkillSlug` in
`src/server/registry.ts`); `getServerSkill`/`getServerSkillMd`/`quoteServerSkill`
resolve only registered skills and `getServerSkillMd` additionally confines the
resolved file to `skills/`. As defence in depth `handleApiV1` rejects any decoded
path segment carrying a separator or `..` with `400 INVALID_PATH`. This is why an
encoded traversal such as `/api/v1/skills/..%2Fagent-skills%2F.../skill.md` — where
`pathSegments()` decodes `%2F` back into separators after splitting — cannot escape
`skills/`. Regression: `src/server/path-traversal.test.ts`.

Auth is a bearer token hashed with SHA-256 and looked up as `api_keys.key_hash`; the
raw token never reaches the store. `HASNA_SKILLS_BOOTSTRAP_API_KEY` seeds a dev
org/user/key. Scopes and roles are parsed and returned but not yet enforced —
authorization today is org scoping.

`skills-worker` claims one run at a time via `store.claimNextRun()`, honours
`cancel_requested`, and on error backs off linearly (`idle × consecutiveErrors`,
capped at 30s). `executeRun()` in
`handlers.ts` currently implements a provider-free handler for three skills only
(`audio-transcript-pack`, `transcript`, `video-highlight-pack`); anything else fails
with `HANDLER_UNAVAILABLE` rather than pretending.

### Library — `src/index.ts`

Re-exports registry, installer, project state, run state, skillinfo, config, remote
registry/client, remote run contract, pricing, discovery, tool primitives, scheduler,
skill validation, portable skills, CLI↔MCP parity, registry sync, MCP contracts,
feedback, skill aliases, native storage, and API types.

`src/storage.ts` is the `@hasna/skills/storage` subpath entry. It is a **duplicate**,
not a split: `src/index.ts` re-exports the same ~40 `native-storage.ts` symbols
verbatim, and nothing tests that the two lists agree. Add a storage export to one and
you must add it to the other by hand.

## Invariants worth knowing before you change anything

### No deployment modes

Removed wholesale (see `CHANGELOG.md` → Unreleased → Removed). There is no `mode`
config key, no `HASNA_SKILLS_STORAGE_MODE`, no `skills setup --mode`, and no `mode`
in `/health`. A `mode` key left in an old config file on disk is **ignored, not
migrated**. `skills config unset <key>` replaced `setup --mode local`.

The one fact that survives is whether an API origin is configured, and
`src/lib/api-url.ts` is the only place that is resolved: `resolveApiUrl()` returns
`undefined` on read paths (callers fall back to the bundled registry), and
`requireApiUrl()` throws `MissingApiUrlError` on auth and write paths.

Regression guards: `src/lib/config.test.ts` (all eight legacy `mode` *values* throw
`Unknown config key: mode`), `src/cli/cli.runtime.test.ts` (`setup --help` contains
`--api-url` and not `--mode`), `src/server/app.test.ts` (`/health` has no `mode`
property).

### No vendor endpoint defaults

An unconfigured install must never produce a URL on a vendor-controlled host — there
is no fallback endpoint and no localhost default. `src/lib/vendor-host-guard.ts`
enforces this over the **packed** file list (not `src/`, because `files` negation
globs make the repo and the tarball different byte sets), with two checks of
deliberately different strength: an **allowlist** over URL string literals in code,
found by walking the TypeScript AST so position cannot hide one; and a weaker
**denylist** over prose. Naming a third-party provider's own published API for a
bring-your-own-key skill is explicitly allowed.

Related: `src/lib/infra-identifiers.ts`, which expresses "vendor infrastructure lives
behind one indirection" as six properties rather than a blocklist — `aws-account-id`,
`aws-arn`, `infra-resource-name`, `unparameterized-workflow-infra`,
`workflow-vendor-host`, and the cardinality rule `manifest-location-not-unique`. And
`src/lib/content-scan.ts` (secret values, contact PII, personal data, private fleet
context, and committed tool output). All findings are redacted before printing,
because they surface in potentially public CI logs.

### Durable storage or nothing

SQLite is the zero-config default. With `HASNA_SKILLS_DATABASE_URL` / `DATABASE_URL`
unset the server opens `<data dir>/server.db` and migrates it itself. Postgres is the
alternative and must be migrated explicitly with `skills-migrate` — several replicas
must not race to migrate a shared database.

**The server refuses to start on a non-durable store.** `assertDurableTarget()` runs
against the *pure resolved target* before any file or connection is opened, so a
rejected configuration never creates a database. `MemorySkillsStore` still exists but
is unreachable without naming `memory:` explicitly *and* setting
`HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1`. There is no silent in-memory fallback. The
worker applies the same guard. `skills-migrate` refuses a non-durable target and
refuses to run with nothing configured, because the deploy workflow gates rollout on
its exit code.

Unresolvable database strings throw with a diagnosis rather than guessing; an
unreachable Postgres, or a reachable one with no schema, aborts startup rather than
falling back and splitting data across two stores. Connection errors are summarised
through a redactor that strips anything URL-shaped.

Artifact bodies live in the `skills_artifacts.body_text` column unless
`HASNA_SKILLS_S3_BUCKET` is set, in which case they go to S3. There is no
local-filesystem artifact backend.

### Skill names are bare; the corpus lives under the app root

`skills/pdf-generate`, not `skills/skill-pdf-generate`. `normalizeSkillName()` in `src/lib/utils.ts`
is now the identity function and is kept only so call sites do not have to change.
`src/lib/skill-aliases.ts` holds the handful of real renames (`generate-pdf` →
`pdf-generate`, etc.).

The installed corpus is `~/.hasna/skills/installed/<name>/`, with app data
(`config.json`, `auth.json`, `skills.db`) at the app root — matching every sibling
Hasna app. `$HASNA_SKILLS_DIR` relocates everything resolved through `getDataDir()`
and outranks `$HOME` there. **Two paths are not yet routed through it and stay
`$HOME`-rooted regardless**: `src/lib/auth-store.ts` (its paths are frozen as
import-time constants from `homedir()`, so `auth.json` ignores the override) and
`create-sync-config.ts`. Both are tracked follow-ups; the caveat matters because it
also means the hermetic-test override below does not isolate `auth.json`.

The legacy `~/.hasna/skills/custom/` path is still read as a migration safety net,
and `~/.skills` / `~/.skillsrc` are merged forward without deleting the originals.

### Pins, not installs

`.skills/project.json` records **metadata-only pins** — name, version, source,
timestamp. Nothing copies skill source or SKILL.md into a project or an agent skills
folder. `installSkillSource()` and `installSkillManifest()` exist and deliberately
return `success: false` with an explanatory error; the MCP `pin_skill`/`unpin_skill`
tools do the same when handed a `for: <agent>` argument, redirecting to
`skills mcp --register <agent>`. `.skills/` is output state:

```
.skills/
├── project.json                  # pins, disabled skills, default export dir
├── runs/<day>/<run-id>/logs/     # run records and logs
├── exports/<skill>/<run-id>/     # sibling of runs/, NOT nested inside it
├── tmp/
└── schedules.json
```

Skills execute from the bundled package source, the portable corpus under
`~/.hasna/skills/installed/` (`runPortableSkill()`), or the configured API — never
from `.skills/`.

### Executable vs instruction skills

`kind` in SKILL.md frontmatter, mirrored into `SkillMeta.kind`. `executable` (the
default when absent) means a runnable folder with `package.json` + `src/`.
`instruction` means SKILL.md-primary prose an agent follows — no credentials, no
runtime. `runSkill()` refuses instruction skills with an explanatory error rather
than trying to spawn them.

The public OSS catalog is **declarative-only**: every shipped skill is
`kind: "instruction"`, so there are currently **zero** executable skills and **zero**
hosted skills, and `PREMIUM_SKILLS` is empty. `src/lib/catalog-runnable.test.ts`
asserts the hosted set stays empty, that every shipped skill is instruction-kind
prose with no `src/`, that each SKILL.md ships in the packed tarball, and that the
package ships no credential value. The executable-skill and BYO-key guards in that
file still exist (so a restored dev skill would be checked) but currently have no
subject. The `kind === "instruction"` filter is the single ship criterion — the
executable half of the catalog is preserved in the archive tag/tarball noted in the
skill-structure section, not in this package.

### Hermetic tests

`bunfig.toml` sets `root = "./src"` and preloads `src/test-preload.ts`, which points
`$HASNA_SKILLS_DIR` at a throwaway directory before any test file is imported and
re-points it per test. Without it the suite reads and writes the developer's real
`~/.hasna/skills` and fails differently on every machine. Tests that need the `$HOME`
resolution branch opt out with `withHomeDataDir()` / `withTempHome()`; child
processes that must resolve from a given `$HOME` use `withoutDataDirOverrideEnv()`.

The isolation is only as wide as `getDataDir()`, so it does not cover the
`$HOME`-frozen paths noted above — notably `~/.hasna/skills/auth.json`.

Set `NO_COLOR=1` for deterministic CLI output in tests.

### ESM with `.js` extensions

Relative imports carry `.js` even from `.ts` sources (`from "../lib/registry.js"`).
JSON imports use `with { type: "json" }`. This is a convention, not an invariant —
nothing enforces it, and `src/lib/remote-run-contract.ts` currently imports
`"./pricing"` bare. Follow the convention in new code; do not assume it holds when
reading.

## Skill structure

```
skills/<name>/                # bare name, matches SkillMeta.name exactly
├── SKILL.md                  # frontmatter: name, description, [kind], [category], [tags]
├── package.json              # skills.kind: "instruction" (declarative); "bin" for runnable ones
├── src/                      # executable skills only — absent in the declarative catalog
│   └── index.ts
├── README.md                 # optional
└── CLAUDE.md                 # optional
```

Every shipped skill is an instruction skill: just `SKILL.md` + `package.json`, with
`kind: instruction` in the frontmatter and `skills.kind: "instruction"` in the
package, and no `src/` at all. Executable skills (with a `bin` entry, `src/index.ts`,
and a `tsconfig.json` extending `../tsconfig.base.json`) are still supported by the
validation and packaging guards but none currently ship — they live in the archive,
not the package. The full 229-skill catalog (210 executable + 19 instruction) is
preserved at git tag `archive/skills-catalog-229-2026-07-27` and in the rescue
tarball under `~/.hasna/repos/rescue/skills-catalog-229/`; restore a dev skill by
copying its directory back and re-adding its `SkillMeta` entry to the matching
`src/lib/registry-data/*.ts` file.

Every shipped skill carries a SKILL.md — for instruction skills the SKILL.md *is*
the skill, always present and always the source of `kind`. Executable skills may omit
it (their metadata lives in the `src/lib/registry-data/` entry and `generateSkillMd()`
synthesises a document on demand), but none currently ship in the declarative catalog.

`src/lib/skillinfo.ts` picks the best doc in the order SKILL.md → README.md →
CLAUDE.md, extracts env vars with `ENV_VAR_PATTERN` (suffixes: `_API_KEY`, `_KEY`,
`_TOKEN`, `_SECRET`, `_URL`, `_ID`, `_PASSWORD`, `_ENDPOINT`, `_REGION`, `_BUCKET`)
and `GENERIC_ENV_PATTERN` (known provider prefixes), and detects system dependencies
by scanning docs for known tool names.

`findSkillsDir()` — in `src/lib/installer.ts`, not `skillinfo.ts` — walks up to 5
parents from `__dirname` looking for a `skills/` directory that is not inside a
`.skills` path, so it resolves from both `src/lib/` in development and `bin/`/`dist/`
when built. It falls back silently to `<__dirname>/../skills` if nothing matches.
`src/lib/validation.test.ts` carries its own slightly different copy.

## MCP tool reference

38 tools. Grouped by registrar; required parameters in **bold**.

**`discovery-tools.ts`** — `list_skills` (category, profile, detail, limit, offset) ·
`list_pinned_skills` (directory) · `search_skills` (**query**, profile, detail, limit,
offset) · `get_skill_info` (**name**) · `get_skill_docs` (**name**) ·
`list_tool_primitives` (query) · `get_tool_primitive` (**name**) ·
`get_skill_tool_dependencies` (**name**) · `validate_tool_primitives` (profile)

**`operation-tools.ts`** — `scaffold_skill` (**name**, description, overwrite) ·
`port_skill` (**path**, name, overwrite, allowShadow) · `pin_skill` (**name**, for,
scope) · `pin_category` (**category**, for, scope) · `unpin_skill` (**name**, for,
scope) · `list_categories` · `list_tags` · `get_requirements` (**name**) ·
`run_skill` (**name**, input, args,
detail) · `get_run_status` (**run_id**, detail) · `export_skills` · `import_skills`
(**skills**, for, scope) · `whoami`

**`schedule-tools.ts`** — `schedule_skill` (**skill**, **cron**, name, args) ·
`list_schedules` (limit, offset) · `remove_schedule` (**id_or_name**) ·
`detect_project_skills` (directory) · `validate_skill` (**name**)

**`storage-tools.ts`** — `storage_status` (directory) · `storage_sync_plan`
(directory, includeSchemaSql)

**`resource-meta-tools.ts`** — `search_tools` (query, detail) · `describe_tools`
(**names**) · `get_mcp_contracts` (names, includeResources) · `register_agent`
(**name**, session_id) · `heartbeat` (**agent_id**) · `set_focus` (**agent_id**,
project_id) · `list_agents` · `send_feedback` (**message**, email, category)

There are no `install_skill` / `remove_skill` tools; they are `pin_skill` /
`unpin_skill`. The agent-session tools keep state in a per-process in-memory `Map`.

**Resources:** `skills://mcp/contracts`, `skills://registry`,
`skills://tool-primitives`, and the template `skills://{name}`.

`src/lib/mcp-contracts.ts` holds a parallel machine-readable contract manifest for the
same tools and resources, served by `get_mcp_contracts` and pinned against a
compatibility fixture in `src/lib/fixtures/`. It currently lists the same 38 tools and
4 resources, but **nothing enforces that**: `mcp-contracts.test.ts` compares the
manifest against a hand-picked subset fixture, and `describeMcpToolContracts()` returns
`{ known: false, description: "Unknown tool" }` for anything missing. So adding a tool
without adding its contract fails no test — do both.

`src/lib/cli-mcp-parity.ts` declares a CLI↔MCP mapping table with the same caveat: it
covers only the `portable-skills` and `tool-primitives` domains, only
`portable-skills` entries are cross-checked against the contract manifest, and nothing
checks the reverse direction or that the CLI command strings resolve against commander.

## Testing

`bun test` with `bun:test` (`describe`/`test`/`expect`). Test roots and preload come
from `bunfig.toml`. Tests live beside the code they cover.

Beyond ordinary unit tests, a large share of this suite is **guards** — tests whose
job is to fail when an invariant erodes. Read the file header before changing one;
most explain what they replaced and why the replacement is not weaker.

| Area | Files |
|---|---|
| Registry & catalog | `registry.test.ts`, `validation.test.ts`, `search.test.ts`, `skill-aliases.test.ts`, `renamed-skills.test.ts`, `basic-skills.test.ts`, `catalog-runnable.test.ts` |
| Pins, docs, execution | `installer.test.ts`, `skillinfo.test.ts`, `skillinfo-run.test.ts`, `portable-skills.test.ts`, `scheduler.test.ts` |
| Boundaries & packaging | `public-boundary.test.ts`, `public-package-boundary.test.ts`, `packlist.test.ts`, `api-boundaries.test.ts`, `upstream-boundary.test.ts`, `unconfigured-client-boundary.test.ts`, `no-cloud-boundary.test.ts`, `release-guard.integration.test.ts` |
| Content & infra guards | `content-scan.test.ts`, `infra-identifiers.test.ts` |
| Data dir & migration | `hermetic-data-dir.test.ts`, `installed-skills-layout.test.ts`, `skill-corpus-migration.test.ts`, `config.test.ts` |
| Server | `app.test.ts`, `store-selection.test.ts`, `store-parity.test.ts`, `schema-parity.test.ts`, `sqlite-store.test.ts`, `sqlite-claim.test.ts`, `security.test.ts` |
| CLI | `src/cli/cli.*.test.ts` (auth, discovery, docs-info, import-export, pin, portable-skills, run-core, runtime, storage, tags-brief, tool-primitives) |
| MCP | `src/mcp/mcp.test.ts`, `src/mcp/mcp-http.test.ts`, `src/lib/mcp-contracts.test.ts`, `src/lib/cli-mcp-parity.test.ts` |
| Docs | `claude-md.test.ts` (this file's counts), plus `product-brief.test.ts`, `open-core-saas-pattern.test.ts`, `human-approval-model.test.ts`, and siblings that assert `docs/**` content |

`src/lib/claude-md.test.ts` re-derives the [Derived counts](#derived-counts) table. It
checks only that table — never prose — so rewording this file cannot break it, while
adding a skill, an MCP tool, a bin, or a build step will.

### Timeouts

The per-test timeout is **30s**. `DEFAULT_TEST_TIMEOUT_MS` in
`src/test-preload.ts` is the only place the number lives. **A new test that
spawns a subprocess needs no timeout argument** — bun's 5000ms default is what
made subprocess tests fail at 5001-5003ms on a loaded machine, and the fix is the
default, not an annotation per test.

Every test file opens with two lines:

```ts
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
```

`src/test-timeout.test.ts` fails if a test file omits them, so a new file cannot
quietly run at 5000ms. It looks like boilerplate because bun leaves no
alternative — measured on bun 1.3.14:

- `[test] timeout` in `bunfig.toml` is **accepted and silently ignored**.
- `setDefaultTimeout()` at preload module scope reaches **exactly one test file**.
- `setDefaultTimeout()` from a `beforeEach`, and a `BUN_TEST_TIMEOUT` env var,
  do nothing at all.
- `--timeout` on the command line works globally, and `bun run test` passes it —
  but plain `bun test` is what people and agents actually type.

Use `HASNA_SKILLS_TEST_TIMEOUT_MS` to override for one run, including to *lower*
it when telling a hang apart from a slow test.

### Build before test, locally

One boundary guard (`every declared entry point is packed, read and certified`)
can only read `bin/` and `dist/`, which exist only after a build. On an unbuilt
checkout that one check reports itself as skipped with a one-line reason rather
than failing, so a fresh clone does not open with a red that looks like a
regression. Run `bun run build` first to exercise it locally; CI never skips it,
and a *partial* build still fails it.

## Adding a new skill

1. Create `skills/<name>/` (bare name, no prefix) with `SKILL.md` and `package.json`.
   Executable skills also need `src/index.ts`, a `bin` entry, and `tsconfig.json`
   extending `../tsconfig.base.json`. Instruction skills set `kind: instruction` in
   both SKILL.md frontmatter and `package.json` `skills.kind`, and ship no `src/`.
2. Add the entry to the right category file under `src/lib/registry-data/` — one file
   per category, re-exported by `registry-data/index.ts`. Do **not** add it to
   `src/lib/registry.ts`; that file no longer holds the array.
3. Bump the `Catalog skills` row (and `Instruction-kind skills`, if applicable) in
   [Derived counts](#derived-counts).
4. `bun run build && bun test`. `validation.test.ts` checks registry↔directory
   consistency both ways; `catalog-runnable.test.ts` checks the skill is actually
   runnable from the packed package.

## TypeScript

Strict mode. Target ES2022, module ESNext, `moduleResolution: bundler`, and
`jsx: react-jsx` for Ink. The root `tsconfig.json` compiles `src/**/*` only —
`skills/` is explicitly excluded, and executable skills carry their own tsconfig
extending `skills/tsconfig.base.json`. So `bun run typecheck` does **not** type-check
the skill corpus.
