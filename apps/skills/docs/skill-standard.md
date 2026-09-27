# Portable Skill Standard

Portable skills live in one folder each:

```text
~/.hasna/skills/installed/<skill-name>/
├── SKILL.md
├── skill.json
├── AGENTS.md
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

`skills new <name>` creates this layout. `skills scaffold <name>` is an alias,
and `skills create <name>` uses the same authoring corpus. Both creation commands
accept `--kind instruction` for a prose skill; the default is `executable`.
An owner layout migrated by Skills uses `~/.hasna/skills/skills/<skill-name>/`.
`skills port <path>` and `skills add <path>` copy an existing skill folder into
this layout and add missing standard files.

## Edit, prepare and publish

Edit the local draft's instructions, resources, code and metadata, then choose a
new semantic version and review preparation before publication:

```bash
skills create release-guide --kind instruction
# Edit the SKILL.md in the path reported by create.
skills prepare release-guide --version 0.2.0 --dry-run --json
skills prepare release-guide --version 0.2.0 --json
skills validate release-guide
skills push release-guide --dry-run
skills push release-guide
# On another station using the same configured instance:
skills pull release-guide@0.2.0
```

`prepare` validates a private candidate before updating only `skill.json`'s
authoritative version, declared kind and canonical content hash. It preserves
other manifest fields and does not rewrite `SKILL.md`, `package.json`, code or
resources, execute helpers, install dependencies, or call an API. Review any
separate package version yourself when the skill also publishes a package.
Changed canonical content requires a higher semantic version; build metadata
alone is not a version bump. Preparing an already valid, unchanged version is
idempotent. Dry-run leaves the authoring corpus and configuration unchanged.

An existing manifest without `kind` requires an explicit `--kind instruction`
or `--kind executable` during preparation. Instruction skills may contain
helpers, so their presence does not decide the kind. Invalid candidates and
conflicting kind declarations are refused: when deliberately changing kind,
align any explicit `SKILL.md` kind with the candidate `skill.json` kind and
provide the required executable files before preparing. Preparation never
rewrites that frontmatter. Source
symlinks at the selected skill root or its included descendants are refused
without changing the draft; existing HOME/corpus ancestor aliases remain
supported. `push` validates and
uploads the reviewed bytes; it never silently repairs a stale manifest hash.

## The manifest split

Two metadata surfaces exist, with one rule: **portable metadata lives in
`skill.json`; consumer frontmatter stays minimal.**

- `skill.json` is the machine-readable manifest and the **source of truth**
  for everything the fleet needs to know about a skill: identity, version,
  runtime contract, provenance. It is the `hasna.skill.v1` contract defined
  in `schemas/skill.schema.json` (published at
  `https://hasna.dev/schemas/skill.v1.json`).
- `SKILL.md` is the agent-facing document. Its frontmatter carries only
  `name` and `description` (plus `user_invocable: true` where a Claude
  consumer renderer needs it). Everything else — `kind`, `version`,
  `source`, `category`, `tags`, `displayName` — lives in `skill.json`.
  See `docs/authoring-rule-amendment.md` for the proposed fleet rule text.

```yaml
---
name: my-skill
description: What this skill does and when to use it.
---
```

## Skill Kinds

A skill declares its artifact class with the `kind` field in `skill.json`
(`kind` may also appear in `SKILL.md` frontmatter for compatibility with
existing Codewith conventions):

- `kind: executable` — a runnable skill folder with
  `package.json`, a non-empty `bin`, and `src/index.ts`. `skills run` executes it.
- `kind: instruction` — a `SKILL.md`-primary prose skill for coding agents.
  `package.json`, `bin`, and `src/` are all optional. Instruction skills may still
  bundle optional helper scripts (a `bin`/`src` is permitted, not forbidden), but
  they are consumed by agents via `SKILL.md`, not executed. `skills run` on an
  instruction skill returns a clear "not runnable — instruction skill" error
  instead of executing a stub.

New scaffolds always record their selected kind. Legacy local readers retain
their executable fallback, while the legacy publication API retains its
instruction fallback for omitted kinds. `prepare` removes that ambiguity
through the author's explicit selection without changing old API behavior.

## Naming

Skill names are lowercase slugs: letters, numbers, dots, underscores, and
hyphens. The folder name, `SKILL.md` frontmatter `name`, `skill.json` `name`,
and `package.json` `name` must match.

## The `hasna.skill.v1` manifest

Every portable skill needs a `skill.json` manifest conforming to
`hasna.skill.v1` (schema: `schemas/skill.schema.json`). The templates always
emit a complete valid manifest; `skills validate` rejects one that is
incomplete, invalid, or whose `content_hash` does not match the bundle.

### Required fields

| field | type | meaning |
|---|---|---|
| `standard` | string | `"hasna.skill.v1"` |
| `name` | string | Lowercase slug; matches the folder name |
| `description` | string | What this skill does and when to use it |
| `version` | string | Semver (e.g. `0.1.0`). Any content change requires a version bump |
| `runtime` | object | The runtime contract below; optional for explicit `kind: instruction` |
| `provenance` | object | Source and integrity fields; `content_hash` is required |

### Optional fields (legacy-compatible)

| field | type | meaning |
|---|---|---|
| `$schema` | string | `https://hasna.dev/schemas/skill.v1.json` |
| `displayName` | string | Human-facing name |
| `category` | string | Marketplace / registry category |
| `tags` | string[] | Searchable tags |
| `kind` | `"executable" \| "instruction"` | Artifact class |
| `inputs` | object[] | Declared inputs (`name`, `type`, optional `required`, `description`) |
| `commands` | object[] | Runnable commands (`name`, `entry`/`command`, optional `args`, `description`) |

### The runtime contract

An explicit `kind: instruction` manifest may omit `runtime`. Preparation keeps
that omission and does not invent an executable entrypoint. If runtime metadata
is supplied for an instruction, its fields still must satisfy this contract.
Executable manifests and legacy manifests without an explicit kind retain the
strict runtime requirement.

| field | type | default | meaning |
|---|---|---|---|
| `runtime` | `"bun" \| "node" \| "python3"` | *(required)* | Execution runtime. `bun` is the Hasna default |
| `version` | string | — | Optional runtime version constraint (e.g. `"22"`, `">=3.12"`) |
| `entrypoint` | string | `commands[0].entry` | Relative path to the runnable entrypoint |
| `timeout` | integer | `900` | Max execution seconds, **capped at 900** |
| `needs_network` | boolean | `false` | Whether execution requires network egress |
| `env` | string[] | `[]` | **Secret REFERENCE names only, never values** — uppercase identifiers such as `OPENAI_API_KEY` |
| `sandbox` | `"readonly-fs" \| "workspace-write" \| "full"` | `"readonly-fs"` | Filesystem access granted to execution |
| `system_deps` | string[] | `[]` | Allowlisted system binaries (see schema for the list) |
| `artifacts` | string[] | `[]` | Glob patterns of artifacts the skill may produce (e.g. `"out/**"`) |

### The provenance fields

| field | type | meaning |
|---|---|---|
| `source_commit` | string | Git SHA of the source revision, or `"unknown"` for locally scaffolded skills |
| `content_hash` | string | **Self-referencing** canonical SHA-256 of the normalized bundle (see below). Required on every manifest |
| `changelog` | string | Pointer to changelog / release notes (relative path or URL) |

### Example

```json
{
  "$schema": "https://hasna.dev/schemas/skill.v1.json",
  "standard": "hasna.skill.v1",
  "name": "my-skill",
  "description": "What this skill does and when to use it.",
  "version": "0.1.0",
  "kind": "executable",
  "displayName": "My Skill",
  "category": "Development Tools",
  "tags": ["custom"],
  "inputs": [
    {
      "name": "args",
      "type": "string[]",
      "required": false,
      "description": "Arguments passed after `skills run my-skill`."
    }
  ],
  "commands": [
    {
      "name": "my-skill",
      "entry": "src/index.ts",
      "description": "Run my-skill.",
      "args": ["...args"]
    }
  ],
  "runtime": {
    "runtime": "bun",
    "entrypoint": "src/index.ts",
    "timeout": 900,
    "needs_network": false,
    "env": [],
    "sandbox": "readonly-fs",
    "system_deps": [],
    "artifacts": []
  },
  "provenance": {
    "source_commit": "unknown",
    "content_hash": "<64 lowercase hex chars>",
    "changelog": "CHANGELOG.md"
  }
}
```

If `skill.json` is absent, the CLI can infer a portable manifest from
`SKILL.md` frontmatter plus `package.json` `bin`, but scaffolded and ported
skills always keep a complete `skill.json` checked in. A manifest present
without a valid `content_hash` is rejected by `skills validate`.

## Canonical content hashing

`content_hash` is a **self-referencing** SHA-256 over the normalized skill
bundle:

1. **Coverage** — every file at the skill root (`SKILL.md`, `skill.json`,
   `AGENTS.md`, `package.json`, `tsconfig.json`) plus every file under
   `src/`, `scripts/`, `assets/`, and `references/`, recursively.
2. **Exclusions** — `node_modules`, `.git`, `dist`, `build`, `.turbo`,
   dot-entries, and symlinks never enter the hash.
3. **Normalization** — line endings are normalized to LF; for `skill.json`
   the manifest is **blank-canonicalized**: parsed, its own `content_hash`
   field (top-level or under `provenance`) removed, and re-serialized with
   sorted keys. Key order, CRLF, and the hash's own presence therefore never
   change the digest.
4. **Determinism** — files are hashed in sorted relative-path order (posix
   separators), each entry length-prefixed, so the digest is identical on
   every platform for the same logical content.
5. **Verification** — `skills validate` recomputes the hash and rejects any
   manifest whose declared `content_hash` does not match, with the computed
   value in the error message.

### Versioning rule

**A content change requires a version bump; the same version with different
content is rejected.** Enforcement is structural: any content change alters
the canonical bundle, so the declared `content_hash` no longer matches and
`skills validate` fails (`contract.content_hash_mismatch`). Re-hashing
without a version bump is still a rejection signal for the registry/server
later, which pins by version + hash — same semver + different hash is
unpublishable.

## Agent Handoff

`AGENTS.md` is required for portable skills created or ported by the CLI. It
tells a coding agent where to put logic, how to update the manifest, how to test
the skill, and how to verify it with:

```bash
skills validate my-skill
skills run my-skill --help
```

## Runtime

The first command in `skill.json.commands` is the default for:

```bash
skills run my-skill [args...]
```

For Bun/TypeScript skills, point `entry` at `src/index.ts`. The CLI runs the
entry from the skill folder, passes through arguments, and records run metadata
under the caller project’s `.skills/runs` and `.skills/exports` directories.

## Validation

```bash
skills validate my-skill --json
```

Validation checks:

- folder and name safety;
- `SKILL.md` frontmatter compatibility (including a valid `kind`);
- the `hasna.skill.v1` contract: `standard`, `name`, `description`, `version`
  (semver), the runtime contract (runtime, timeout cap, sandbox, env reference
  names, system-deps allowlist), and provenance;
- the canonical `content_hash`: present, well-formed, and matching the bundle
  (`contract.content_hash_mismatch` on drift);
- `skill.json` standard, version, inputs, and commands (relaxed for
  `kind: instruction`, which needs neither `commands`, `inputs`, nor `AGENTS.md`);
- `AGENTS.md` presence (executable skills only);
- `package.json` and command entrypoint safety (`package.json`/`bin`/`src` are
  optional for `kind: instruction`);
- no reserved files such as `.env` or symlinks.

An invalid manifest exits non-zero with the exact field errors.

## Porting Existing Skills

```bash
skills port ./old-skill
skills add ./old-skill --name new-name
```

Porting copies the folder into `~/.hasna/skills/<name>/`, skips generated and
dependency directories such as `node_modules`, `dist`, and `.git`, then adds or
normalizes `skill.json`, `AGENTS.md`, `package.json`, `tsconfig.json`, and an
entrypoint when they are missing. Missing contract fields (runtime defaults,
provenance) are filled and the `content_hash` is recomputed over the ported
bundle; unknown keys in an existing `skill.json` are preserved.

## Machine Layout

The skills app folder (`~/.hasna/skills/`, relocatable with
`$HASNA_SKILLS_DIR`) hosts the owner layout:

```text
~/.hasna/skills/
├── skills/     canonical corpus cache — the sync source
├── logs/       run/sync logs (created lazily)
├── outputs/    run outputs (created lazily)
├── custom/     experiments, retained as-is
├── config.json
└── skills.db
```

`skills/` replaces the older `installed/` corpus home, and legacy flat skill
dirs that predate `installed/` migrate into it. Both moves are opt-in and
idempotent:

```bash
skills storage migrate            # installed/ + legacy dirs -> skills/, creates logs/ + outputs/
skills storage migrate --dry-run  # show what would move, write nothing
```

Migration refuses to run against a non-empty `skills/` that carries no
migration record (`skills/.layout-migration.json`), and never touches
`custom/`. After a successful migration `skills sync` reads the corpus from
the new cache automatically.

### Unmarked-home adoption

Agent homes are full of skill directories the CLI never wrote (the ad-hoc
sed/scp/rsync era). Those carry no `.hasna-skills.json` marker and sync leaves
them alone by design. Adoption is the migration mode for that population:

```bash
skills sync --adopt             # dry-run: hash unmarked home skills vs the corpus
skills sync --adopt --apply     # write markers for exact matches; ledger the rest
skills sync my-skill --adopt --for codex --source ./skills --apply
```

Each unmarked home skill's `SKILL.md` is hashed (line endings normalized,
`user_invocable` stripped) and compared against the canonical corpus cache:

- exact match -> a marker is written and the dir is adopted;
- content differs -> recorded in `~/.hasna/skills/conflicts.json` (home, skill,
  hash, canonical hash, mtime) and skipped — an unmarked dir is never
  overwritten;
- no canonical entry -> reported as unknown and skipped.

Every written marker is listed in a rollback record under
`~/.hasna/skills/rollback/`. Nothing is ever deleted by adoption.

### Managed home ownership

Ordinary sync updates an existing directory only when its regular
`.hasna-skills.json` sidecar contains `managedBy: "@hasna/skills"`. Missing,
foreign or malformed markers leave the directory unmanaged. A directory with
`SKILL.md` can still be explicitly replaced using `skills sync --force`;
an unmanaged directory without `SKILL.md` is always preserved. Preview mode
uses the same ownership decision and writes nothing.

The library's `removeManagedAgentSkill` and `removeSkillForAgent` follow the same
exact-owner check, including project and global agent installs. They return
`false` and preserve a directory without valid Skills ownership; neither has a
force override.

Remote tombstones also preserve directories without exact Skills ownership.
Registry reconciliation accepts a marker's baseline hash and version only when
that same marker names the Skills owner. Foreign or invalid markers cannot choose
which divergent copy wins; the existing conflict policy and explicit overrides
still apply.

### Home drift census

```bash
skills sync --check             # exits non-zero while drift exists
```

Compares each existing agent home against the canonical corpus and lists
`missing-from-home`, `stray-in-home` (marked dir, no canonical entry), and
`diverged` (marked dir whose hash differs). Unmarked dirs are adoption
candidates, not drift. `skills diff <name>` and `skills outdated` use the same
home-vs-canonical comparison; the pinned-skill version comparison remains as a
subset. `skills sync --prune [--apply]` removes only marked-and-stray dirs,
recording each removal in the rollback store before it happens. Adoption and
prune honor `--source` (then `$SKILLS_SOURCE`, then the installed cache), `--for`
and optional skill names. Names are normalized and must exist in the selected
corpus or selected agent homes; a stale prune target need not exist in the corpus.
Invalid selections fail before any apply write. Prune requires the marker
`managedBy` to be exactly `@hasna/skills`; another tool's marker never grants
deletion authority. Adoption also leaves every already-marked directory alone.
Rollback records contain identities, hashes and markers, not backups of removed
file content.

## Recovering interrupted dependency preparation

Local executable skills prepare missing dependencies before running their entry,
including when `--help` is forwarded to that entry. Preparation has a 60-second
default deadline; callers of the public root `runSkill` export can set
`preparationTimeoutMs`. Installer diagnostics are drained without exposing
registry URLs or lifecycle output. A failed preparation returns a nonzero result
and the CLI records a failed run.

The selected skill directory temporarily contains `.skills-dependency-preparation`.
Successful preparation removes this marker. A confirmed failure keeps a retryable
failed state, so a later invocation prepares again even if `node_modules` was
partially created. Existing dependencies are preserved.

An interrupted, active, malformed, or symlinked marker refuses execution. To recover:

1. Identify the selected skill directory and confirm that no dependency installer
   or lifecycle child is still running for it. Do not terminate a process based on
   a PID found in a skill directory.
2. Review the skill's package and lifecycle scripts, then run `bun install --no-save`
   in that exact directory with the intended environment. Require a successful exit.
3. Remove only that directory's `.skills-dependency-preparation` marker, then retry
   the original Skills command. Preserve `node_modules` and all other skill files.

Do not remove an incomplete marker merely to bypass preparation. If the directory
is read-only, prepare it through its owner before running it.

The root `.skills-dependency-preparation` directory is local runtime state. Bundles, portable copies, and authoring snapshots exclude it; a nested directory with that name remains authored content. Moving an existing local corpus preserves its dependency tree and preparation state together.
