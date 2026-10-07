# @hasna/skills

Skills library for AI coding agents — discover, pin, and run reusable capabilities through the Skills CLI and MCP server. Registers with Claude, Codewith, Codex, OpenCode and Cursor, and works with any MCP host.

[![npm](https://img.shields.io/npm/v/@hasna/skills)](https://www.npmjs.com/package/@hasna/skills)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install The CLI

```bash
bun install -g @hasna/skills
```

Requires [Bun](https://bun.sh/) 1.3+.

## Private skill catalogs

The public package provides the CLI, API, SDK, hooks, and runtime. A skill's
instructions and executable bundle belong to the organization that publishes
them. API reads require authentication and use that organization's catalog,
including tag filters, versions, and downloads. An empty account starts empty;
neither a repository checkout nor files on the server machine supply defaults.
Server startup and upgrades never import a bundled catalog.

Each operator can use their own compatible server and storage. S3 is optional:
the server supports durable SQLite or PostgreSQL and database-backed bundles
when no S3 bucket is configured. Publishing through an authenticated account
does not publish to GitHub or npm. Keep private source documents and executable
payloads outside public software repositories.

## Quick Start

```bash
bun install -g @hasna/skills
skills login
```

`skills login` opens your browser to sign in to https://skills.md and stores an
API key for this machine in `~/.hasna/skills/config/credentials` (owner-only),
together with the server it belongs to. On a terminal it then offers to register
Skills with your coding agents (`skills setup agents`). Check who you are with
`skills whoami`.

`skills logout` signs out the active profile. It deletes the key that
`skills login` stored, then revokes it on the server that issued it when login
minted it (a key you added with `--api-key` is only deleted, unless you pass
`--revoke`). It exits 0 only when you are signed out. It exits non-zero, naming
the reason, when revocation did not complete or is not supported (it then says
where to revoke the key by hand), when another credential is still active (an
environment variable, the Keychain or another selected profile, which it never
changes), when the profile holds a credential `skills login` did not store
(left in place), or when the local deletion failed.

- No browser on this machine: `skills login --device` prints a code to approve
  on another device, then `skills login --poll` finishes the same sign-in.
- An API key you already have: `printenv MY_SKILLS_KEY | skills login --api-key`
  reads it from stdin, verifies it and stores it. Nothing is echoed.
- An email code instead of the browser: `skills login --email you@example.com`.
  Interactive code input is masked. For an agent or headless terminal, first
  request a code with `skills login --email you@example.com --json`, then send
  the fresh code through stdin to `skills login --email you@example.com
  --code-stdin --json`. This finishes the same sign-in without requesting another
  code. Keep the code out of shell commands, arguments and logs.
- Running `skills` in a terminal opens the interactive browser. It also works
  signed out and has the same account commands: `/login`, `/logout`, `/whoami`.

### Your own server

The software is open source and every command works against your own compatible
Skills server. Sign in to it with
`skills login --url https://skills.example.com`; the URL is stored with the key,
so later commands use that server without flags. `HASNA_SKILLS_API_URL` selects
a server for one shell. `skills setup --api-url <origin>` records a server
without signing in.

### Fleet stations

Stations provisioned with a fleet key keep using the internal gateway
`https://api.hasna.com/skills`; versioned requests use `/skills/v1`. A key with
no recorded URL (the Keychain item, `HASNA_SKILLS_API_KEY` alone, or an older
credentials file) always stays on that gateway and is never sent anywhere else.
The gateway has no interactive login service, so on such a station
`skills login` says so, sends nothing, and names the credential to unset first.
Obtain a workspace API key through your administrator's provisioning process
and configure it using the [credential resolution](#credentials) below. Check
the selected identity and available capabilities before syncing:

```bash
skills whoami --json
skills capabilities --json
```

A workspace administrator creates a shared profile selecting published skills by
exact version and SHA-256 digest. Consumers sync that profile into a verified
Skills cache, then load instructions through the CLI. Replace `default` with
your assigned profile; these examples assume it selects `pdf-generate@0.5.2`:

```bash
skills list --json
skills profiles show default --json
skills sync --selection-profile default --json
skills install pdf-generate@0.5.2 --selection-profile default --json
skills load pdf-generate@0.5.2 --selection-profile default
skills context 'Use $pdf-generate to create a PDF' --selection-profile default --json

# Preview retirement, then archive ordinary copies and vendor discovery files.
skills migrate native --include-unmanaged --include-vendor --json
skills migrate native --include-unmanaged --include-vendor --apply --json

# Preview the available adapters, then install one bridge plus hooks per agent.
skills hook agents --json
skills hook install --agent all --selection-profile default --json
skills hook install --agent all --selection-profile default --apply --json
```

Native migration includes the current directory, every ancestor, and the global
agent directories. Use `--project /path/to/project` to include another project
and its ancestors. This matches the prompt hook's project discovery, including
skills inherited from a parent workspace. Preview the JSON inventory before
applying it; archived copies retain recovery receipts. A drift refusal reports
the affected paths without printing their skill documents.

Claude hook installation sets `syncClaudeAiSkills: false` in user settings to
stop [account skill synchronization](https://code.claude.com/docs/en/skills#skills-synced-from-claudeai)
from recreating native copies. The prompt hook checks that setting. Vendor
migration also inventories `~/.claude/plugins/synced/` and archives its skill
documents while preserving other plugin files. Whole-plugin synchronization
remains unchanged because synced plugins can also provide hooks, MCP servers,
and language servers. A later plugin download that restores a skill document
will trigger another drift refusal and require review.

A patched Codex that enforces an exact native host-path allowlist reports its
effective policy to the Skills SessionStart and UserPromptSubmit hooks as
`native_skill_policy`. The guard's adapter parses that envelope strictly
(capability `host-path-allowlist-v1`, restricted mode, non-host sources disabled,
the sole allowed path equal to the Skills bridge document, a lowercase SHA-256
`effectiveConfigDigest`, the consumer's `processId`, `session_id`, and `turn_id`
on UserPromptSubmit only), re-verifies the bridge document on every hook, walks
the hook's real parent chain to find the claimed consumer, binds its start time
and the digest of its executable to the reviewed digests stored under
`bridge.codexNativePolicy.executableDigests` in the managed policy (an absent set
refuses; Linux has no reviewed digest by default, so the adapter refuses there
unless an operator pins one after its own review; only the file's identity to
digest mapping is cached, in `agent-hooks/codex-native-policy-executable-cache.json`).
The Skills data directory is the operator trust root: the managed policy and the
cache file must be regular files reached through no symlink, owned by the current
user or root and writable by neither group nor world, or the adapter fails closed;
a writer with the same uid is outside this boundary. The adapter then requires
the authenticated channel binding of the native hook-policy peer contract
(`native-hook-policy-peer-v1`): Codex passes
the read end of a per-hook socketpair in `CODEX_NATIVE_SKILL_POLICY_FD`; the hook
forwards it as fd 3 to the qualified ancestor's own executable, `debug
verify-hook-policy --fd 3 --expected-process-id <pid> --input-sha256 <raw stdin
SHA-256>`, which sends a fresh challenge, verifies the actual writer and prints
one `native-hook-policy-peer-v1` attestation that must name that pid, that raw
stdin digest and exactly the emitted policy; it runs once per invocation and is
never cached. The managed trust default is empty, so no envelope is accepted
until an operator records reviewed executable digests; with none, the helper is
never run, and the hook's remaining deadline bounds both the first-use executable
hash and the helper. Operators bind those digests through the package, never by
editing the policy by hand:

```bash
skills hook trust-native --platform darwin-arm64 --digest <sha256> --expected-policy-sha256 <sha256> --json
skills hook trust-native --platform darwin-arm64 --digest <sha256> --expected-policy-sha256 <sha256> --apply --json
```

Preview comes first and writes nothing. Each `--digest` must be the SHA-256 of an
independently verified final native artifact, taken from its own review, never
from a fetch; the command accepts digests only from its arguments. `--apply`
requires the exact current policy SHA-256, re-checks it immediately before the
atomic 0600 replace, preserves the pre-change bytes in the usual migration backup
and reads the backup and the result back before it reports; it sets exactly the
given set for that one platform and preserves every other field (values
identical; the file is re-serialized with the package formatter).
A pre-existing group- or world-writable data directory (for example 0775) refuses
both this command and the adapter until its mode is corrected. Inertness rests on that authenticated restricted policy;
plugin classification proves nothing by itself and only narrows the scope to
installed-plugin documents under `~/.codex/plugins/cache` that the verified policy
cannot load. Those are checked before any hash or helper run, and the acceptance
is recorded at `agent-hooks/codex-native-policy-acceptance.json`; user,
repository and project copies still refuse, and format or digest checks never
prove the runtime policy on their own.

Native hook invocations must use their installed adapter's selection profile.
An old client command or environment override naming another profile refuses
before synchronization or context loading. Review the hook installation and
restart the native client to load its current commands. Explicit `skills load`,
`skills context`, and `skills sync` commands can still select other profiles.

Reinstalling hooks without `--command` or `--selection-profile` preserves each
agent's existing executable and profile independently, including when using
`--agent all`. New agents use `skills` and `default`. Either explicit flag
overrides that choice for the requested agents. The policy's shared default
profile changes only when `--selection-profile` is supplied; older managed
agents without a per-agent profile retain that shared default.

The hook install `--include-vendor` option is retained for compatibility with
older scripts. Hook planning always inventories and disables discovered vendor
system skills; use `migrate native --include-vendor` when retiring their
discovery files.

Restart the agent after applying the hooks. In Codex, review and grant normal
trust to the installed hook definitions before starting a new session. Then
request a selected skill in a prompt, for example `Use $pdf-generate to create
a PDF`. The hooks supply instructions; executing the skill remains a separate
explicit action.

For Codex 0.153.0, 0.154.0, and 0.155.0, the normal installed Skills CLI can
plan native trust for its three exact managed hook definitions:

```bash
skills hook trust --agent codex --json
skills hook trust --agent codex --apply --plan-digest <reviewed-plan-digest> --json
```

Review the commands, current hashes, and existing trust/enable state in the
plan. Apply refuses if the plan, package, declarations, or configuration changed.
The plan preserves the native `CODEX_HOME` choice. When unset, Codex uses
the lexical `~/.codex` path; an explicit `CODEX_HOME` resolves canonically.
Only the home root and an explicitly admitted canonical root-alias target
are accepted. Those views have separate hook identities even when they reach
the same files; enrolling one preserves the other's trust entries. Keep the
same `CODEX_HOME` choice for enrollment and the consuming agent.
It enrolls the current exact definitions, including reviewed modified hooks,
and preserves unrelated trust, settings, and comments. A private journal keeps
the pre-write configuration; a failed write or verification requires journal
reconciliation before retry. Unsupported versions or configuration layouts
refuse without a configuration write. Enrollment uses a short-lived native
app-server and makes hooks eligible for new Codex processes. Existing sessions
retain their own configuration; use their native hook controls to refresh them.

When an explicit discovery review includes the full Codex configuration file,
the exact native trust writes change that file's byte hash. Enrollment verifies
those writes and completes its journal with `bindingRefreshRequired: true`.
This reports native trust eligibility only: ordinary managed context remains
blocked, and the discovery policy is unchanged. Review the current full file
again and plan `skills hook install --agent codex --discovery-inputs <review>
--command <same-absolute-command> --json`. Verify that the plan changes only the
discovery policy, then repeat with `--apply`. Keep the same command and native
home. The ordinary bridge must then pass, and a fresh `skills hook trust
--agent codex --json` must report zero planned changes and
`bindingRefreshRequired: false`. Verify context in a new native session after
these checks; an enrollment receipt does not prove context was consumed.

If an interrupted journal's policy later changed only in reviewed Claude
discovery roots/sources, `skills hook trust reconcile --agent codex --journal
<path> --review-claude-discovery <evidence-reference> --json` can preview that
specific recovery. Supply all five package provenance flags shown by
`skills hook trust reconcile --help` for the current running Skills release.
The old absolute hook command remains bound to its original package bytes;
recovery reads that package as evidence without executing it. Review the full
policy hashes, exact discovery additions/removals, journal, current package,
configuration and complete native inventory in the private preview. Repeat
the same command with `--recovery-plan-digest <reviewed-digest>` to record the
receipt. Any unreviewed change refuses. This mode preserves the policy and
native configuration and cannot be combined with `--supersede-binding`.

If another reviewed producer appended a user hook after the interrupted write,
add `--review-native-hook-additions <private-review.json>`. This is a separate
explicit review; a producer receipt alone never authorizes recovery. The review
must be an absolute, owner-only regular file with these exact fields:

- `version: 1`, `kind: "native-hook-additions"`, a nonempty `reason`, and a
  `producerEvidence` reference to the independently reviewed producer operation.
- `journalIntentSha256`, `policySha256`, `configCurrentSha256`, and
  `hooksCurrentSha256` pin the complete current inputs and immutable intent.
- `producerBefore` contains `configPath`, `configSha256`, `hooksPath`, and
  `hooksSha256`. These owner-only backup files must reproduce exactly the
  completed original trust write and the original hook declarations.
- `additions` contains one or more `{ event, nativeHook }` records. `event` is
  `UserPromptSubmit`, `SessionStart`, or `SubagentStart`. `nativeHook` contains
  exactly the native inventory fields `key`, `eventName`, `handlerType`,
  `command`, `matcher`, `timeoutSec`, `async`, `statusMessage`,
  `additionalContextLimit`, `sourcePath`, `source`, `pluginId`, `isManaged`,
  `currentHash`, `enabled`, and `trustStatus`.

Only appended single-command groups from the same user hook file are supported:
no matcher, asynchronous handler, custom status/context limit, plugin source,
duplicate command, replacement or reordering. The added hooks must already be
enabled and trusted in the actual native inventory. Every original hook and
unrelated configuration byte remains verified. Combine this flag with
`--review-claude-discovery` only when that independent policy transition is also
present. The package provenance flags, private preview, exact
`--recovery-plan-digest`, and subsequent explicit binding refresh are still
required. Reconciliation writes only its journal receipt.

When updating the Codex binding afterward, Skills replaces its single hook
group in place so neighboring hooks retain their native indexes and trust
identities. Ambiguous duplicate or mixed Skills groups refuse installation.

Each supported agent gets one small `skills-cli` native skill containing CLI
instructions, without a copied catalogue. Claude's native Skill tool admits
that bridge after other copies are retired. Prompt guards verify the owned
bridge bytes, required native configuration, and discovered home/project skill
paths before loading context. A missing or changed bridge, newly discovered
copy, stale plugin registration, or incomplete scan reports repair guidance and
refuses loading. Most adapters also block the prompt; Hermes has the native
non-blocking prompt-hook limitation described below. These are checks on configured native discovery, not
an operating-system restriction on arbitrary file reads.

Agent policies support up to 1 MiB of serialized UTF-8 JSON, with bounded agent
and discovery collections (2,048 sources and 512 roots per agent). Installation
validates the complete resulting policy before writing configuration or backups;
the same limits apply when reading and guarding native context. A rejected plan
leaves the previous policy intact.

Sumi uses its native V2 plugin API, independently of OpenCode. Its managed
`plugins/skills-cli.js` plugin validates prompt admission and adds selected
instructions to transient request context. Real native session IDs and parent
IDs bind exact inherited pins; native agent definitions are not Hasna identities.
Native payload tool calls and prompt attachments are refused except for the
`skills-cli` bridge. The supported configuration resolver honors `SUMI_CONFIG_DIR`,
`XDG_CONFIG_HOME` and `SUMI_HOME` without performing native home adoption.

Sumi integration refuses unresolved JSONC, inline/additional config, remote or
relative skill sources, flat Markdown skills and foreign plugin packages.
Resolve or review these sources before applying integration. The adapter was
checked against Sumi 0.2.52. That release watches plugin sources for hot reload;
installation alone does not prove an existing session adopted the plugin.
Verify actual prompt consumption on each target after installation.

Hermes 0.20.5 uses `pre_llm_call` to add selected context and `pre_tool_call`
with `fail_closed: true` and a small owned supervisor to guard tool calls. The
supervisor maps Skills child failures, timeouts and missing/invalid directives
to the native explicit block response and exit code 2. Installation edits `config.yaml`
while preserving unrelated values/comments and creates the native
`.no-bundled-skills` opt-out marker to prevent bundled payloads from reappearing.
The supervisor stays in the Skills data directory and its bytes/command are
checked before native loading. Installation leaves the native shell-hook
allowlist unchanged: approve the two exact
managed event/command pairs through Hermes normal hook trust and restart.
The adapter refuses unreviewed installed plugin sources and custom Hermes
homes/profiles, user-specific tilde expansion, and `TERMINAL_CWD` overrides.
Nonempty `HERMES_BUNDLED_PLUGINS` and `HERMES_BUNDLED_SKILLS` overrides are
also refused during discovery and hook checks; unset them to use the reviewed
default source paths. Custom bundle locations need a dedicated discovery adapter.
Retire native payloads before use. Legacy `skills-cli.md` files can shadow the
bridge and must also be preserved and retired before proceeding. Only `skill_view(name:
"skills-cli")` is allowed natively; author payloads with Skills CLI commands.
Hermes itself fails open on `pre_llm_call` errors. A returned refusal is visible
context, and the trusted pre-tool guard blocks drift and native skill fallback;
this is not a claim that Hermes can prevent every model call after a failed
prompt hook or guarantee refusal if the native host/supervisor itself dies. Arbitrary project/plugin paths still require a discovery audit.

Reviewed discovery can also bind `directories: [{ path, sha256 }]` alongside
its full source-file hashes. The public SDK's `captureDiscoveryDirectories(paths)`
captures recursive, sorted path/type membership without reading plugin payloads.
Include every directory the reviewed loader scans, including plugin version
selection parents and Python entrypoint discovery directories. Membership hashes
detect added, removed or changed file types; keep source hashes for reviewed bytes.
Missing directories bind as `sha256: null`. Symlinks and special nodes refuse.
The bounds are 64 roots, 20,000 total entries, 8 MiB of path/type metadata and
64 levels of recursion. Capture and checks require stable directory identities;
quiesce source writers for installation because these checks are not atomic with
a later native import.

For full binary or source-byte coverage, use the public SDK's
`captureDiscoveryByteSources(paths)` and retain its explicit `hashMode: "bytes"`
on each source witness. It hashes the exact file bytes, including invalid UTF-8,
with limits of 64 MiB per file and 256 MiB across one capture or verification.
Missing files bind as `sha256: null`; symlinks, special files and changing file
identities refuse. Raw witnesses cannot use configuration field projections.
Existing witnesses without `hashMode` retain their original UTF-8 decoding
contract and 16 MiB file limit; they are not silently converted into byte hashes.
Directory membership and file bytes are separate witnesses. Neither substitutes
for reviewing the actual executable, import paths or loader behavior.

For reviewed Claude user settings, `captureClaudeSettings(canonicalSettingsPath)`
emits an opt-in `claude-settings-v1` witness. It permits a fixed set of typed
terminal display preferences and recognized built-in model selections to change
while binding hooks, permissions, native skill protections, plugins,
marketplaces, environment and every unknown field. Provider mappings, custom
model values and instruction settings remain bound. Replace the settings source
in an explicitly reviewed discovery input, then use the normal `skills hook install
--discovery-inputs <file>` plan/apply flow; existing raw witnesses are never
automatically converted or refreshed. See [settings witness scope and migration](docs/plugin-admission.md#claude-settings-preferences).

For an explicitly reviewed launcher or interpreter reached through symlinks,
use `captureDiscoveryPathSources(paths)` and retain `hashMode: "path-bytes"`.
Its digest binds the canonical input, directory identities, each link's identity
and target, and the resolved regular file's identity and exact bytes. Relative
link targets resolve component by component, including `..` after an alias.
Missing targets also receive a digest that binds the path leading to their
absence. Retargeting to identical bytes, replacing a link or an ancestor, or
changing a file's metadata requires a fresh review. Unrelated sibling writes
do not change directory identity witnesses.

Path witnesses share the 64 MiB file and 256 MiB aggregate byte limits. Each
path allows at most 40 links, 256 traversal steps and 64 KiB of metadata; one
capture or verification permits 8 MiB of path metadata. Special nodes, cycles,
oversized inputs and changes during capture refuse. Native hook checks repeat
the witness verification; this does not make a later native execution atomic
with external writers. Keep source writers quiescent during activation.
Use `bytes` mode for configuration that hook installation will replace: path
witnesses cannot predict the future identity of a planned write. Existing raw
byte and directory witnesses still refuse links. Older clients reject the new
mode; upgrade the CLI before installing a policy that uses it.

Hermes requires directory witnesses, including when upgrading an older policy.
For an automatic bridge with no runtime installed, rerun normal `skills hook install`
to review and apply the new bindings. Existing native trust is preserved.
Reviewed Hermes installations need fresh source and directory coverage in their
`--discovery-inputs` file. Other agents may add directory witnesses to their
reviewed bindings without changing existing source-only reviews.

Hook installation preserves unrelated configuration, hooks, and plugin assets.
For Codex it sets `skills.bundled.enabled = false` in user configuration, preserving
the `skills-cli` bridge and disabling discovered native skill paths. This prevents
supported Codex clients from installing or loading their bundled `.system` skills.
The setting and its discovery witness are enrolled in the same configuration
transaction; existing installations must rerun `skills hook install`. Missing or
re-enabled bundled protection fails `skills hook check` before context loads.
Ordinary `[skills.bundled]` and legacy `[[skills.config]]` tables are supported;
inline or dotted target definitions that require rewriting refuse before changes.
Convert those definitions to ordinary tables while preserving their values, then
rerun installation. The control has been verified with Codex 0.153.0, 0.153.4 and
0.154.0; this is not a claim that every older build supports it. Use a client that
supports `skills.bundled.enabled`; Skills does not infer support from version text
or silently substitute path-only protection. Existing exact system-skill trees can
remain only with their hash-bound disabled paths; migration preserves these package
files. A client that restores or changes packaged skills requires a fresh inventory
and disable plan. Native exports are
refused while managed CLI loading is active. Migration preserves ordinary skill
directories in private archives; `--include-unmanaged` includes user-authored
copies, and `--include-vendor` retires vendor `SKILL.md` discovery files while
preserving shared scripts and assets. Archive receipts and configuration backups
live under the Skills data directory.

After vendor documents are archived, inventory still scans their retained asset
directories for newly introduced skills. Vendor container traversal allows 32
directory levels; the ordinary native-root limit remains unchanged. Each inventory
is bounded to 20,000 discovery entries and 4 MiB of UTF-8 path metadata before
directory entries are retained or sorted. Unsupported special files and unsafe
directory links are refused.

Native archives persist a version 2 recovery journal before moving payloads;
`migrate native --json --apply` returns its `receiptPath`. The journal records
every source, archive path, expected hash, and move status, then marks successful
completion. Interrupted operations can be inspected against that durable intent.
On failure, recovery restores verified archives only when the original path is
still absent. It preserves occupied paths or unverified archives, records that
they require recovery, and continues compensating other unchanged entries.
Keep native agents and other skill writers stopped throughout migration and
recovery: portable directory rename cannot atomically reserve an absent target.
Vendor file restoration uses an exclusive hard link to preserve concurrent files.
Do not retry an interrupted operation until its journal and both paths have been
reconciled; a failed final journal write may leave the earlier durable intent.

For a reviewed migration that must retire one exact native copy, pass
`--target-manifest <file>`. The JSON manifest uses schema
`hasna.skills-native-migration-targets.v1` and binds each target to an agent,
an existing absolute `projectRoot`, a normalized project-relative `path`, and
the complete directory `treeSha256`. Exact-target mode refuses broad selector
flags, protected or vendor entries, missing or ambiguous paths, symlinks,
digest drift, and writes a manifest digest into the recovery journal. Every
inventory entry outside the manifest remains untouched.

`skills hook agents --json` reports the supported adapters and coverage limits.
Claude and Codex have lifecycle context hooks; Gemini uses `BeforeAgent`, and
OpenCode uses its awaited message plugin. Cursor receives selected context at
session start and gates later prompt submission; its prompt hook does not
inject context on the supported installed path. Other inventoried clients do
not automatically gain a working prompt adapter.

Gemini's `BeforeAgent` prompt can include the Skills policy emitted at session
start. The hook excludes that exact leading policy from skill selection, so it
does not displace the user's requested skill. Other hook context and user text
remain part of the selection input.

Gemini discovery also covers the installed `@google/gemini-cli` package and its
bundled builtin skills. `skills hook install` finds the package through the
`gemini` command on its PATH and records the resolved executable and its
realpath target in the managed policy (`bridge.discoveryExecutables.gemini`).
Later checks always verify that recorded path, and also look `gemini` up on the
caller's PATH, because what PATH resolves is what that process would run:

- If PATH resolves a `gemini` whose realpath differs from the recorded target,
  that runtime shadows the reviewed one, and the check refuses with
  `NATIVE_SKILL_DRIFT`, naming both targets. Another launcher for the same
  target is not a shadow.
- If PATH resolves no `gemini` at all (a narrower PATH such as
  `env -i PATH=/usr/bin:/bin` or a launchd unit), the recorded path is the only
  witness, so a Claude hook update or a Gemini hook still verifies the reviewed
  runtime.
- A changed recorded target, package or builtin set refuses with
  `NATIVE_SKILL_DRIFT`.
- When the recorded executable no longer resolves, or a policy written before
  this record cannot find `gemini` on the caller's PATH, and nothing else in
  the reviewed discovery changed, the refusal is `DISCOVERY_ROOT_UNRESOLVED`,
  naming the agent and the command. That is an environment gap rather than
  drift, and it still blocks. Any other change is still `NATIVE_SKILL_DRIFT`.

An install treats a recorded executable that no longer resolves as no record.
Run `skills hook install` from the reviewing environment to record or refresh
the path. The SDK exports `DISCOVERY_ROOT_UNRESOLVED` and
`isDiscoveryRootUnresolved` for callers that classify refusals.

Known local plugin registrations are resolved automatically. Plugins with
instruction-injecting hooks, unresolved runtime registrations, unsupported
legacy command formats, and higher-precedence project discovery settings need
separate review; a cache-only scan does not establish complete coverage. The
advanced `--discovery-inputs <file>` option on hook installation and migration
accepts reviewed active roots and full source-file SHA-256 witnesses. Its
version-1 document has an `agents` array; each entry names `agent`, absolute
`roots`, `sources` (`path` and `sha256`, or `null` for an absent file), and
`pluginHooks: "reviewed-no-skill-injection"`. Include the agent configuration
and every input establishing the active roots and plugin-hook behavior. A
changed witness requires a new review. This option does not add support for an
unknown native file format or make unreviewed plugin behavior safe. Managed
system configuration, process-specific overrides, and alternate agent home
directories are outside automatic coverage and require their own integration
review before declaring a station migrated.

The `pluginHooks` attestation is the reviewer's point-in-time statement; Skills
does not inspect hook behavior. When a Claude `.claude-plugin/plugin.json` is
listed as a plain byte witness (`hashMode` omitted or `"bytes"`) with a
non-null `sha256`, Skills also requires plain byte witnesses for that plugin's
`hooks/hooks.json` (when present) and any string `hooks` target in the
manifest. A manifest listed as `claude-plugin-manifest-v1` (the form Skills
writes into the stored policy) or as `path-bytes` triggers no such requirement.
For plugins outside receipt-backed admission (a `claude-plugin-registry`
witness, see the
[discovery transition contract](docs/plugin-admission.md#discovery-transition-contract)),
other plugin files such as hook modules, `bin/` files and `package.json` are
bound only if the review lists them (a reviewed `directories` membership witness
detects only added or removed files, not content changes), and the review is not
checked against the roots registered in
`~/.claude/plugins/installed_plugins.json`. Later checks
re-hash the stored sources, and drift makes the Skills hooks refuse with
`NATIVE_SKILL_DRIFT`; this detects a change but does not stop plugin code from
running. A process running as the same user can rewrite the plugin files and
the managed policy, so the witness is a tripwire, not a security boundary. See
[the full scope](docs/plugin-admission.md#reviewed-plugin-hook-attestation-scope).
A stronger witness for plugins outside receipt-backed admission is planned and
not yet implemented.

When `hook install` omits `--discovery-inputs`, it reuses an existing reviewed
binding only after rechecking its sources, directory membership, configuration
coverage, managed bridge and native trust. Unchanged reviews need no new input
file; drift still requires a fresh explicit review. Explicit discovery inputs
take precedence, including when their `agents` array omits a previously reviewed
agent. The default `--agent all` still includes every supported adapter.

For reviewed Claude plugins, `skills integration plugin plan`, `admit` and
`resolve` provide a command-source admission boundary before native discovery.
Original packages and migrated skill/command prompts remain in private versioned
Skills storage. Native projections retain ordinary components, and a typed
receipt permits only verified registry/cache transitions. See
[plugin admission](docs/plugin-admission.md) for the package, review and runtime
contracts; these commands do not change live agent registrations or settings.

If your home `.claude` or `.codex` directory intentionally links to another
directory within your home, add `--allow-root-aliases` to hook installation and
native migration. The plan records and rechecks the exact link and target;
links inside skill contents or configuration files remain refused.

On macOS, the OS-owned `/var`, `/tmp` and `/etc` aliases into `/private` are
accepted only while their exact targets and protected parent directories verify.
The protection check refuses extended ACLs and unavailable native ACL inspection.
Inventory reports canonical paths and deduplicates their alias spellings. This
does not permit other root-owned links or user-controlled ancestor links.

Cooperating installers can use the root package's
`planClaudeStopHookUpdate({ expectedSettingsSha256, replacement })`, then
`applyAgentIntegration(plan)`, to write an explicitly authorized Claude settings
replacement changing only `hooks.Stop`, together with every existing discovery
witness for that file. Every other field and hook must retain the same value;
this includes discovery configuration and display/model preferences.
The caller must authorize its own exact change; this API does not grant approval
to change another owner's hooks. It checks the current native bridge, inventory,
policy, executable witnesses and root aliases, preserves each witness mode, and
verifies the consumer guard after applying. A concurrent edit or pre-existing
drift refuses renewal. Failed post-write checks compensate only unchanged writes,
retaining private backups. A `null` plan means no Skills policy exists; malformed
or untrusted policy throws instead. This local integration operation requires no
hosted credential, does not reload an existing agent, and cannot adopt a stale
policy after another installer has already changed settings.
Settings and policy are separate files: this is a guarded sequence with
compensation, not a cross-file atomic commit. A concurrent hook can fail closed
during installation. A successful update does not reload an existing session.

Legacy full-file settings witnesses remain strict until explicitly upgraded:

```bash
skills hook rebind-settings --agent codex \
  --reviewed-preimage /private/preserved/config.toml \
  --expected-policy-sha256 <current-policy-sha256> \
  --expected-settings-sha256 <current-settings-sha256> --json
```

For Sumi, use `--agent sumi` and the exact preserved `sumi.json`. A fresh
review can capture `skills hook witness --kind sumi-settings-v1 --path
<absolute-sumi.json> --json` and include that witness in its discovery inputs.
The versioned witness permits JSON whitespace and changes to `$schema`,
`username`, `experimental.statusline` and `experimental.compact_tools` only.
All other fields, unknown controls, nested plugin options, permission-map order
and array order remain protected. Foreign plugin source witnesses and the
explicit hook review remain required. Missing preserved bytes require a fresh
review; the runtime never upgrades a stale review automatically.

The Sumi plugin emits a fixed `SkillsHookRefusal` error with the own data property
`skillsHookRefusal: { version: 1, code: "SKILLS_HOOK_REFUSED" }`. Its remediation
is fixed; child stderr and arbitrary hook reasons are never copied into the
error. A compatible Sumi adapter can present this refusal without turning it
into an untyped server error. Regenerate the managed plugin with the normal
guarded `skills hook install --agent sumi` flow after updating Skills.

The plan proves the preserved original matches every witness being replaced,
permits only the documented non-discovery differences, and labels the replacement
witness (the JSON receipt lists them under `replacedWitnesses`). `--apply`
preserves and reads back the original policy before writing, and never writes the
native configuration. Claude upgrades to `claude-settings-v3`, or to
`claude-settings-v4` with `--claude-witness-version 4`; Codex uses
`codex-settings-v2`, which also replaces the narrower automatic
`plugins`/`marketplaces`/`skills` projection of the same file once the preserved
original is proved to explain it. That projection is order-sensitive, so it keeps
failing after Codex re-serializes the file it owns.

Existing `codex-settings-v1` witnesses retain their original verifier. New reviews
use `skills hook witness --kind codex-settings-v2 --path <config.toml> --json`.
The guarded rebind accepts a raw or v1 witness only when the exact preserved
configuration proves its original digest and any automatic projection. Without
that preimage, capture a fresh native catalog and explicitly review all discovery
inputs before installing a v2 binding; runtime never adopts drift automatically.

The Codex v2 witness binds the whole configuration apart from native-owned state
that is not a discovery input: the `hooks.state` trust ledger Codex rewrites when
it trusts a hook, table order and other serialization-only differences, retired
`[[skills.config]]` entries that explicitly disable one skill, and `model`,
`model_reasoning_effort` and `model_verbosity` at the root or in `[profiles.*]`.
Every hook declaration, provider mapping, plugin, skill source or enablement,
project-trust entry, environment setting and unknown field stays bound, and a
malformed inference selection refuses instead of being adopted. Runtime hooks
never silently upgrade a witness.

A supported Codex native skill and installed-plugin receipt can be captured through the
package-owned client into a new private file, then reviewed and passed to
`hook install` with `--codex-native-catalog <file>`:

```bash
skills hook native-catalog --cwd /absolute/project --output /private/catalog.json --json
skills hook install --agent codex --codex-native-catalog /private/catalog.json --json
```

Codex 0.159.2, 0.160.0 and 0.160.1 have measured qualified-name catalog support.
Native transport, capture and review use one capability registry of exact
releases. Unmeasured releases, including 0.160.2 and 0.161.0, refuse until the
native catalog/name-denial and hook-dispatch acceptance tests pass; an RPC
handshake alone does not establish those semantics. Admitting a release does not
admit its corpus: the transport still requires the existing native corpus
admission (see `docs/codex-corpus-writers.md`).

The capture refuses an existing output file, writes mode `0600`, verifies the
exact bytes, and reports only version, directory, count, file path and SHA-256.
Its safe catalog shape is `{version,cwd,skills,plugins}`; skills have
`{name,path,enabled,pluginId}` and plugins have
`{id,name,installed,enabled,localVersion}`. Older reviewed catalogs without
`plugins` remain valid for skills present in `skills/list`. The installer matches the native
qualified name against bounded frontmatter and the owning plugin manifest.
If Codex omits a skill from `skills/list` because its exact path is already
disabled, the installer derives that identity only when the exact installed
and enabled plugin row matches the cache marketplace, manifest name and
local version. It preserves path disables and adds exact qualified name disables.
For a newly named remote materialization omitted from the native list, use
`--codex-skill-denials <file>` together with a fresh native catalog and explicit
`--discovery-inputs`. The denial file is an array of exact
`{name,path,sha256}` document reviews. The discovery review must also bind the
current full plugin manifest and each declared app/MCP control file. This plans
only exact false path/name rules;
it requires the real installed remote identity and receipt, rejects conflicting
enables, and rechecks consulted files and configuration before application.
It never synthesizes a native catalog row or enables a capability.

A wholly absent remote skills-only parent with retained qualified-name denies
keeps its reviewed fingerprints. A returning parent must satisfy the same
identity and capability checks. App/MCP declarations and active hooks do not
receive this absence exception; the saved review must explicitly establish the
skills-only role. The planner can also retain an already body-free historical
remote version whose capabilities match the reviewed disabled identity. It
records bounded membership rows matching their original directory fingerprints.
Only exact reviewed inactive roots or wholly absent disabled skills-only parents
are projected out; surviving versions, receipts and unrelated members stay bound.
Direct user hook references, returning skill bodies and capability changes
still refuse. Older directory witnesses without this projection need a fresh
review; their historical hashes are never silently weakened.
Updating the binary preserves existing policy and does not enroll this proof.
Preview `skills hook install` with fresh `--discovery-inputs` and the genuine
`--codex-native-catalog`, then apply the same reviewed inputs with `--apply`.
Preserve the exact policy/configuration/hook preimages and compare them before
application. The apply invocation replans and checks its observed preconditions;
the preview is not an apply token. Keep typed V3 settings witnesses, existing
disables, command/profile choices and session pins unchanged.
A retired Claude cache version may likewise
remain absent only while unchanged native settings and registrations select a
different extant, witnessed user version. Individual missing files, current
registered roots, aliases and registration changes still refuse; historical
source hashes and typed settings witnesses remain intact.

For a Codex 0.160.0 or 0.160.1 remote refresh omitted by an existing qualified-name disable,
a fresh native catalog and discovery review can plan the new exact path disable
in the same transaction. The remote installation receipt, namespace and capability
controls must match; conflicting enable rules, unknown names and ambiguous
materializations refuse. Changed plugin capability controls require a fresh
native catalog even when a new discovery review is supplied.
Known skill identities remain disabled across versioned plugin cache relocation,
even when their disabled bodies change. Unknown names, conflicting enables,
changed plugin controls, native hooks and unsupported name syntax still refuse.
Only manifest version metadata may vary. Reviewed app declarations use the implicit
`.app.json` or explicit `./.app.json`, with a bounded `apps` map containing connector
`id`, optional `category`, and optional boolean `required`. The entire canonical app
file and its presence stay bound; it preserves existing connector availability and
native capability hints. Changed or unknown app fields, custom references, native
hooks, commands and unsupported MCP controls refuse. Referenced own-root
`./.mcp.json` declarations may preserve local stdio servers with Codex's typed
tool, approval, timeout and environment metadata. Their complete fingerprints
and presence remain bound; review never executes commands or resolves environment
values. Name controls suppress Skills, not every plugin capability.
A Codex 0.160 catalog may also prove a nonremote plugin is installed but disabled.
With an exact current path deny and explicit witnessed plugin disable, its cache
can remain inert across versions; re-enable, ambiguous identity, conflicting
controls and unsafe paths refuse. This does not approve its hook declarations.
Remote-controlled, missing or unknown source identities do not qualify.

The catalog retains local source paths separately from installed cache identities.
When a reviewed discovery witness binds a positively mapped installation input,
runtime checks omit that input from plugin skill loading. Default home/project
roots and installed caches are still checked, and migration inventory remains
complete. Overlapping, linked, missing or contradictory mappings refuse.
No prompt hook starts an app server to obtain this receipt:
native startup can maintain caches. The explicit capture starts and closes only its
own bounded native client; it does not reload an existing agent session.
Neither a receipt nor a config write proves an existing session adopted new rules;
use the actual native session's supported acceptance path separately.

At session start, the hook authenticates and refreshes the profile. Prompt hooks
select complete skill instructions from that verified cache using explicit
`$skill` references, profile keywords, paths and always-required selections.
A session retains its loaded selections; compaction restores loaded instructions,
and subagents inherit the parent's selection. Instructions that exceed the
context budget produce an explicit `skills load` command. A hook never executes
a skill. Cached use is explicit and expires after 24 hours. When a session
receipt expires, the hook authenticates the current profile. If every loaded
selection still has identical metadata and bundle digest, it archives the old
receipt and advances that session to the current profile under an exact receipt
precondition. Unloaded selections may be added or removed. If a loaded selection
changed or disappeared, no instructions are delivered until the explicit
reconciliation below. A missing cache may be recovered through authenticated context.

After verifying the native bridge and input, ordinary lifecycle hooks continue
without skill payload on typed hosted authentication/refusal/availability failures,
context timeouts, valid concurrent writers, context CAS conflicts, or required
session reconciliation. They emit a fixed warning that Skills-dependent actions
are unavailable; previously loaded instructions are not an authorization fallback.
The hook does not rewrite a session pin or remove another writer’s lock to bypass these refusals. Explicit `skills
load`, `skills context`, and `skills run` still refuse unavailable or unauthorized
instructions. Native skill tool guards still deny unmanaged payloads. Invalid
input/receipts, integrity or authority mismatches, unknown failures, and native
discovery/control violations remain blocking. No failure silently switches to a
local catalog, native skill or stale bundle.

An intentional change to a loaded selection or profile identity for an already
running session uses a separate reviewed operation. `sync` and hook
reinstallation do not migrate session pins:

```bash
skills sessions show <session-id> --json
skills sessions reconcile <session-id> \
  --from-profile <old-profile> --from-revision <old-revision> \
  --receipt-sha256 <receipt-sha256> \
  --selection-profile <target-profile> --profile-revision <target-revision> --json
# Within five minutes, repeat with --apply --plan-digest <digest> \
#   --plan-issued-at <issuedAt> --plan-expires-at <expiresAt>.
```

Reconciliation authenticates against the current target profile and refuses a
changed target revision, authority, workspace, old receipt or plan. It archives
the original bytes and prepared replacement under
`selection-cache/session-reconciliations`, then replaces only the named session
receipt atomically. Loaded instructions are retained only when their exact
authority, workspace, version and bundle digest still match. Existing child
sessions and project locks keep their own pins; new children inherit the newly
reviewed parent selection. Each new child receipt privately records the exact
parent receipt hash and monotonic generation it inherited. Parent and child locks
are acquired in deterministic path order, and the parent is re-read immediately
before the child commit; any changed or ABA generation refuses the child write.
No agent process is stopped or restarted.

Session write locks created by current releases include the host, boot and
process start identity (plus the Linux PID namespace). After 30 seconds, a
later writer can archive one only when that identity proves the writer is gone
on this same host. The exact lock bytes and a metadata record remain under
`selection-cache/session-lock-recoveries`; the session receipt is not changed
by recovery. A live, recent, malformed or different-host lock still blocks the
write. A recovery guard serializes competing recoverers.

Writers gather identity before publishing the lock. A private, fully written and
synced staging inode is linked into the live path atomically without replacing
an existing lock; the staging name is then removed before the protected write.
The writer keeps its descriptor open through lock release. An interruption at
the brief two-link publication boundary leaves a complete marker and its exact
operation-bound staging witness. Recovery accepts that pair only when both names
identify the same private inode and the existing stale-owner checks pass.
Readers from 0.10.31 and earlier refuse this interrupted two-link state; inspect
and recover it with an updated installation. Ordinary held locks have one link.
This prevents new empty locks; it does not recover historical empty or malformed
locks, whose ownership remains unknown and which must stay protected.

Older PID-only locks require a local review because they do not identify their
host. On the host that created the lock, inspect the receipt and lock, verify
the recorded PID belongs to no live writer, then apply the exact reviewed lock:

```bash
skills sessions recover-lock <session-id> --json
skills sessions recover-lock <session-id> --apply \
  --review-digest <review-digest> --confirm-local-host --json
```

The second command rechecks the lock, receipt, age and PID before archiving.
Keep the archive path returned by the command. If the review changes or the
writer cannot be proven gone, leave the lock in place; do not remove the
session receipt or stop a running agent. A surviving recovery guard also
requires separate review before another recovery attempt.

Use the same updated Skills installation for every process writing this cache.
Session writers coordinate with reconciliation and refuse a stale write that
would restore an earlier pin. Reviewed reconciliation approvals bind their
`issuedAt` and `expiresAt` into the digest and expire after five minutes; after
that replay boundary, prepare and review a new plan. A competing writer or surviving lock fails closed;
do not delete a lock without reviewing its owning operation. If application
reports an incomplete outcome, inspect `sessions show` and the preserved
operation receipt before retrying. The archive contains both original and
prepared bytes even if the final receipt write fails.

## Profiles, station sync and rollback

```bash
# A writer creates a profile from a JSON selection document.
skills profiles set default --file selections.json --json
skills profiles show default --save profile-before.json --json

# Update only the revision you reviewed. Restoring a saved document rolls back
# the selection while producing a new profile revision.
skills profiles set default --file profile-next.json --if-match REVISION --json
skills profiles set default --file profile-before.json --if-match NEW_REVISION --json

# Use the same profile on another station; record exact project selections.
skills sync --selection-profile default --station station-example --json
skills sync --selection-profile default --project --json
skills sync --selection-profile default --check --json
skills station-state station-example --json
```

With `--selection-profile`, `sync --check` checks the selected profile and cache
without writing, and exits nonzero on drift. `sync --station` records a receipt
for the named station; it is not a native-folder snapshot in this mode.
`skills install --selection-profile default` without skill names also syncs the
whole selection.

After hook installation has enabled CLI loading, pull operations obey the same
profile. `--all` refreshes its selected versions rather than the full catalog,
and a named pull must belong to that profile:

```bash
skills pull --all --selection-profile default --json
skills pull pdf-generate@0.5.2 --selection-profile default --json
```

To inspect a published version that is not selected, export its immutable bundle
to an existing owner-only directory outside Git and agent-native discovery:

```bash
skills review-export example-skill@1.0.0 --output /absolute/private/review/example-skill-1.0.0.tar.gz --json
```

The command verifies the version metadata, response headers, byte count, and
SHA-256 before creating a mode-0600 file. It prints a metadata-only receipt and
does not install or select the skill. Review and scan the private archive before
reading its content.

Use `sync --selection-profile default --station station-example` when you also
need a station receipt. Native-folder migration options belong to the older
sync mode and cannot be mixed with profile sync.

Selection documents contain a `selections` array. Each entry has `slug`,
`version`, `bundleDigest` (`sha256:` followed by 64 lowercase hex characters),
and optional `triggers` containing `keywords`, `paths`, or `always`. An optional
`aliases` array gives a selection up to 32 reviewed kebab-case alternate names.
Aliases cannot duplicate another alias or any canonical name in the profile.
They resolve directly to that selection's exact version and digest in `load`,
managed `run`/`pull`, and explicit prompt references such as `$old-name`.
Receipts and bundle requests retain the canonical name. Aliases are scoped to
the authority, workspace and profile revision; project/session locks preserve
their pinned aliases. They do not create global registry entries or native
redirect skills. Saving aliases requires an API advertising `selectionAliases`.
Profiles support up to 4,096 exact selections. API responses and local profile,
project and session documents share an 8 MiB UTF-8 JSON limit. Resolved profiles
reserve space within that limit for all session-loaded keys; the API refuses an
oversized candidate before replacing the existing profile. Saved snapshots and
owned cache receipts use compact JSON; existing formatted receipts remain readable.
The authenticated capabilities response advertises `profileLimits`, including
`maxSelections`, `maxDocumentBytes`, `maxResolvedProfileBytes` and the effective
`requestBodyLimitBytes`. Larger writes require these advertised limits. Operators
can set `HASNA_SKILLS_REQUEST_BODY_LIMIT_BYTES=8388608` to admit larger requests;
the default remains 1,000,000 bytes and a lower configured limit still applies.
These limits apply to configured memory, SQLite and PostgreSQL stores;
profile sync does not require S3 or native skill copies.
Profile
writes use compare-and-swap revisions. Station receipts belong to the workspace,
user and stable station ID, so rotating a key does not create a new station.
Consumers need `skills:read` and `stations:write`; profile publishers need
`skills:write`. Key scopes apply even to workspace owners.

`skills auth whoami --json` reports the current credential's effective
`permissions.publish` and `permissions.profilesWrite`, alongside its account
role and advertised scopes. Human output labels each permission `allowed`,
`denied`, or `unknown`; JSON uses `null` for unknown access. An owner role alone
does not grant either permission. `skills capabilities --json` and the SDK's
`getCapabilities()` also retain the server's typed permission and scope fields.

Before sending a bundle, `push` and `RemoteSkillsClient.publishSkill()` read
fresh capabilities and stop on an explicit publication denial. `profiles set`
similarly stops before a profile write. The refusal reports
`SKILLS_PERMISSION_DENIED` with the affected permission and guidance to obtain
an authorized credential; it never changes credentials or their scopes.
Servers that omit permissions (or predate the capabilities route) retain their
existing server-authorized write behavior, with access displayed as unknown.
Authentication failures and malformed permission responses do not bypass the
preflight. `push --dry-run` remains a local packing check and does not check
hosted publication access.

`--selection-profile` chooses the shared skill selection. The top-level
`--profile` option chooses an isolated credential file; these are separate
settings. `HASNA_SKILLS_SELECTION_PROFILE` overrides the installed selection
profile. A project lock and an existing session keep exact versions until they
are explicitly changed or a new session starts.

## Executable skills

Selected local executables declaring `runtime.env` use shared execution grants
by default. An owner or admin reviews a policy containing exact skill versions
and bundle digests, actor IDs, station IDs, canonical workspace directories, a
Secrets authority and vault reference names. Actual secret values stay in Secrets.
Policy documents are private workspace data stored by the Skills service, with
immutable revision history in SQLite or PostgreSQL; S3 is optional.

For example, keep this policy input in private configuration outside the repository
and skill bundles, replacing the example identifiers and digest with reviewed values:

```json
{
  "grants": [{
    "id": "provider-access",
    "target": "local",
    "selection": {
      "slug": "your-skill",
      "version": "1.0.0",
      "bundleDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "actors": ["user-example"],
    "consumers": [{"stationId": "workstation", "workspaceDirectory": "/workspace/project"}],
    "secretsAuthority": "https://vault.example.com/v1",
    "bindings": {"PROVIDER_TOKEN": "my/provider/key"}
  }]
}
```

```bash
skills grants set default --file ./policy.json --json
skills grants show default --json --save ./policy-snapshot.json
skills run --target local --selection-profile default \
  --input '{"requested":"work"}' --json your-skill@1.0.0
# Updates and revocation require the current policy revision, not the profile revision:
skills grants set default --file ./reviewed-policy.json --if-match <policy-revision>
skills grants show default --revision <prior-policy-revision> --json
```

For executable arguments, use `--` after the skill and Skills options:

```bash
skills run --target local --selection-profile default --json \
  your-skill@1.0.0 -- prepare --input child-input.json --json
```

Everything after that separator belongs to the executable, including flags such
as `--input`, `--json` and any further `--`. Cloud execution accepts structured
Skills `--input` only and rejects executable arguments. Existing calls without a
separator retain their option parsing behavior.

Updating a policy appends a revision and atomically changes its current pointer.
An empty `grants` array revokes shared execution access. Historical policies remain
readable and can be submitted as a new reviewed revision for rollback; they cannot
authorize an execution directly. Unrelated selection-profile edits do not require
rewriting the policy. A changed executable version or digest needs a new grant.

Each run resolves current authorization through the Skills API before reading
Secrets. Missing, expired, ambiguous or revoked grants, changed selections and API
failures stop execution without using a cached grant. Optional `expiresAt` is an
ISO timestamp; `includeDescendants: true` permits canonical directories beneath a
consumer's workspace root. Station and path conditions describe client context;
they are not cryptographic machine attestation. Revocation applies to subsequent
authorization requests, not already running processes.

Grant writers need an owner/admin role and `execution-grants:write` (or
`execution-grants:*`/`*`); `skills:*` alone cannot grant access. Policy and history
reads need `execution-grants:read`. Execution resolution accepts `skills:read` or
`execution-grants:resolve`. Each client still needs independent Secrets access
to the reviewed references. Managed MCP `run_skill` and SDK `executeSelectedLocal`
use the same fresh authorization path. `--cached` cannot consume shared grants.

Explicit local binding files remain available for callers that manage their own
authorization. These caller-supplied grants are independent of shared-policy
revocation. Prepare a template using the configured Skills and Secrets clients:

```bash
skills run --target local --selection-profile default \
  --secret-bindings-template --json your-skill@1.0.0 > bindings.json
# Fill each empty entry in bindings with its reviewed vault key, never its value.
skills run --target local --selection-profile default \
  --secret-bindings ./bindings.json --input '{"requested":"work"}' \
  --json your-skill@1.0.0
```

The template contains no credential values and does not execute the skill or
read the declared secrets. Keep the reviewed file in your private configuration,
outside the skill bundle and agent discovery directories. It uses
`hasna.skills-secret-bindings.v1` and binds the exact Skills authority, workspace,
profile ID and revision, canonical skill name, version and bundle digest, plus
the current station ID (`HASNA_STATION`, otherwise the hostname), canonical
working directory and independently configured Secrets `/v1` authority. Its
`bindings` object maps each declared environment name to one vault key. Changing
any bound field requires reviewing a fresh template. These are explicit local
execution grants; selection sync does not distribute or implicitly approve them.

The CLI validates the complete binding before fetching values through
`@hasna/secrets`. It resolves current values for each run, checks returned keys
and expiry, and injects only the declared variables into the child process.
Missing, extra, stale or mismatched bindings refuse execution; a failing vault
read never falls back to an ambient value or a local vault. Wrapping `skills run`
in `secrets exec` alone does not bind a declared variable. Runtime controls such
as `PATH`, `NODE_OPTIONS` and `SKILLS_INPUT_JSON` cannot be credential names.
Bindings require an explicit local target and a fresh API selection; they cannot
be used with cached, cloud or legacy remote execution. No S3 deployment is required.

Run receipts retain references and scope, never resolved values or captured
output. Returned child output redacts literal, JSON-escaped, base64 and URL-encoded
forms of injected values. This limits accidental disclosure; local execution
has the calling user's filesystem and network access and is not a sandbox for
hostile code. Review the exact executable and grant only the credentials its
effects require. Cloud admission and cloud credential delivery remain separate.
SDK callers use `resolveSelectedRun`, `prepareSelectedSecretBindings` and
`executeSelectedLocal(selected, { secretBindings })` through `@hasna/skills/sdk`.
The same SDK exports `readExecutionGrantPolicy`, `saveExecutionGrantPolicy` and
`resolveExecutionGrant`. The HTTP contract is GET/PUT
`/v1/execution-grants/:profile`, GET
`/v1/execution-grants/:profile/versions/:revision`, and POST
`/v1/execution-grants/:profile/resolve`. Writes use `If-None-Match: *` to create or
the quoted policy revision in `If-Match` to update. The API advertises
`executionGrants: true` and grant permissions in `/v1/capabilities` when supported.
Upgrade the API and apply its database migrations before enabling shared grants.

```bash
skills capabilities --json
skills run --target cloud --selection-profile default \
  --input '{"title":"Example","content":"Hello"}' \
  --idempotency-key YOUR_UNIQUE_JOB_KEY --wait --json pdf-generate@0.5.2
skills executions show RUN_ID --json
skills executions logs RUN_ID --json
skills executions artifacts RUN_ID --json
skills executions download RUN_ID document.pdf --output ./document.pdf
```

Use a new idempotency key for each new job and retain it with the exact input.
If a response is lost or polling times out, reconcile the existing execution
before submitting again. The selected profile must include this exact version,
and the consumer needs `runs:write` as well as `skills:read`.

Cloud execution is enabled only when the deployment configures a reviewed image
and exact bundle allowlist; arbitrary
uploaded code is not admitted. The PDF lane accepts reviewed `pdf-generate` versions.
The optional `regex-test.v1` pure contract accepts only a tenant-specific, reviewed
self-contained Bun bundle, with no secrets, dependencies or network. Uploading or
selecting a bundle never admits it to cloud execution. Check an exact version with
`skills executions eligibility <skill> --skill-version <version> --json`; this
reads metadata without creating a run. Runs capture version, bundle digest, input digest,
runtime image digest, limits and policy. The cloud worker runs in a separate
Fargate task; the skill process has no API/provider credentials, no network, a
read-only root and bounded temporary storage, execution time and output.
`GET /skills/v1/capabilities` reports whether this deployment has cloud execution
configured and lists supported `cloudExecutionContracts`. Each exact bundle needs
its own review and admission; the flag does not promise arbitrary executable
support. Authorization and runtime availability are checked separately.

On a managed station, local execution also resolves the selected immutable
bundle. Self-contained local executables run with explicit environment references
and bounded time/output; declarations requiring isolation or dependency
preparation are refused with cloud guidance. Local execution has the station
user's filesystem privileges. Instruction skills use `skills load`.

Browser/device-code login remains available for compatible custom deployments.
The fleet gateway uses provisioned API keys. `HASNA_SKILLS_API_KEY` is a Skills
API credential, not a provider key. Provider keys such as `OPENAI_API_KEY`
are supplied only to local skills that explicitly declare them.

## Credentials

The credential and the service address are resolved by the shared client in
[`@hasna/contracts`](https://www.npmjs.com/package/@hasna/contracts), the same
ladder every Hasna CLI uses. Nothing here is resolved twice, and this package
keeps no credential store of its own.

**The credential, in precedence order, resolved fresh on every call:**

| # | Tier | Where |
|---|------|-------|
| 1 | Explicit argument | `--api-key`, `--profile` |
| 2 | Deliberate env pointer | `HASNA_SKILLS_API_KEY_OVERRIDE`, `HASNA_PROFILE`, `HASNA_SKILLS_API_KEY_REF` (a secrets-vault item key, never a value) |
| 3 | macOS Keychain | generic-password item `hasna.credentials.skills.api-key`, account `$HASNA_STATION`, else `hostname -s`, else `$USER` |
| 4 | Disk | `~/.hasna/skills/config/credentials` (mode 0400/0600; `HASNA_HOME` and `HASNA_CONFIG_HOME` relocate it; XDG is never consulted) |
| 5 | Environment | `HASNA_SKILLS_API_KEY` — a legitimate tier, and deliberately *below* disk |

Tier 5 sits below disk on purpose. A wrapper that injects `HASNA_SKILLS_API_KEY`
into one child process re-reads its store every time and cannot go stale; a shell
`export` can, and after a key rotation the file on disk is the correct one.

`skills login` (also `skills auth login`) writes tier 4. A tier an operator set on purpose (1 and 2)
never falls through to another identity: if it cannot be honoured, the command
fails rather than acting as a different principal.

`HASNA_SKILLS_API_KEY_REF` names a *vault item*, not a key, so it resolves in two
steps: the item is fetched through the `@hasna/secrets` SDK on each call, which
means a rotated item is picked up without a restart — and which means the SDK has
to be installed in the process. Every way that fetch can fail (SDK absent, vault
unreachable, item missing or empty) is terminal and exits non-zero; a pointer
never falls through to another tier, and never to the local corpus.

For a durable reference without a raw Skills key, the same
`HASNA_SKILLS_API_KEY_REF` field can be stored in the owner-only canonical or
selected-profile credentials file, alongside its `HASNA_SKILLS_API_URL` and
`HASNA_SKILLS_BOUND_API_URL`. Do not keep a literal API key in that file too.
The file retains its existing priority, and the reference remains bound to its
recorded Skills instance. Secrets needs its own working bootstrap provider;
this setup does not unlock a Keychain or copy a Secrets bootstrap credential.
If the file changes during a vault lookup, the request is refused.

An explicit `skills login` replaces a stored reference with the newly
authenticated key. `skills logout` does not remove a stored reference: it
did not come from `skills login`, so logout leaves it in place, names the file
and exits non-zero. Remove the reference from the file to sign that profile
out; the vault item and Secrets' credential are never touched. Changing the
service URL preserves the reference's previous instance binding.

**The service address, in the same shape:**

`HASNA_SKILLS_API_URL` → the Keychain item `hasna.credentials.skills.api-url` →
`~/.hasna/skills/config/credentials` → the fleet gateway
`https://api.hasna.com/skills`. The gateway default applies only once a
credential has resolved, so a data command from an install with no credential
names no host at all. Signing in is the one exception: with no URL and no
credential anywhere, `skills login` signs in to https://skills.md and records
that URL beside the new key. A credential that already resolves keeps its own
server, for data and for signing in. A URL that `skills login` wrote is removed
again by `skills logout` together with the key; a URL you configured with
`skills setup --api-url <origin>` stays. That command writes the credentials
file; the address is per-user, never per-project.

**Which credential may go to which server.** A stored credential goes only to
the server it was stored for: the credentials-file or profile key to its
recorded server (the internal gateway when it recorded none), the Keychain key
to the Keychain `api-url` beside it (else the gateway). A credential that
records no server of its own (`HASNA_SKILLS_API_KEY`,
`HASNA_SKILLS_API_KEY_OVERRIDE`, an environment `HASNA_SKILLS_API_KEY_REF`, or
an explicit argument) goes only to the internal gateway or to a URL from the
environment (`HASNA_SKILLS_API_URL`), never to a URL from the credentials file
or the Keychain. Any other combination is refused before anything is sent. Set
`HASNA_SKILLS_API_URL` alongside such a credential for your own server.

The internal gateway resource contract is `/skills/v1/...`; commercial and custom
instances retain their `/api/v1/...` routes. A full gateway `/skills/v1` base is
accepted and normalizes to the same credential-bound instance. Select a
customer-owned instance explicitly with `HASNA_SKILLS_API_URL=https://skills.example` and
its own profile/credential; configuring one instance does not select the other.
The OSS server accepts `/v1/...` aliases through the same handlers as its
`/api/v1/...` routes, plus `/v1/auth/whoami` for existing API-key identity and
`/v1/health` for liveness. Profile and runtime availability can be checked on the authenticated capabilities endpoint. Login and
device authorization still use `/api/auth/...` on standalone instances; the
internal gateway has no interactive login service, so these operations stop
before transmitting account input or credentials. This is an explicit readiness gap, not support for
logging into the internal service through the commercial account.

The unprefixed `SKILLS_API_KEY` and `SKILLS_API_URL` spellings are still accepted
as silent aliases one rung below the canonical names, for one release. Use the
`HASNA_`-prefixed names. `SKILL_API_KEY` (singular) is no longer read at all.

**Fail closed, and the local run is a deliberate choice:**

- a credential resolves → **hosted**, against the configured URL or the gateway.
  A credential that resolves but cannot produce a usable key — a deliberate
  selection that cannot be honoured, a vault pointer whose item is missing, any
  tier that yields a blank value — is a **loud failure** too, never a demotion;
- no credential but a URL is configured → **loud failure**, exit non-zero. There
  is no local fallback: answering from the bundled corpus while authentication is
  unconfigured is a false green;
- neither a credential nor a URL, and no opt-in → **loud failure**, exit
  non-zero. Running on this machine is no longer the silence that follows a
  missing credential: an unconfigured install fails closed, opening no local
  database and emitting no local-fallback event, and the error names the way
  out and where the credential should live. This holds on every data surface:
  `list`, `search`, `categories`, `tags`, `info`, `show`, `docs`, `requires`
  and the bare `skills` listing all exit 1; `skills-mcp` exits 1 at startup
  before answering `initialize` or binding a port, and each MCP data tool
  answers `AUTH_REQUIRED` on its own;
- the explicit local opt-in → **local**, using only owned drafts and the verified
  local cache. An empty installation has no skills. Opt in with:
  `HASNA_SKILLS_LOCAL=1` (alias `SKILLS_LOCAL=1`). It prints one line saying
  "local mode" on stderr. A configured environment always outranks the opt-in:
  with an authority or credential in the environment, `HASNA_SKILLS_LOCAL` is
  ignored and the run goes (or fails) hosted.

The retired locations are not read: `auth.json` (in either the app directory or
the legacy `~/.skills/`), the old fleet-env and per-machine cloud env folders
under `~/.hasna`, and the XDG config directory. `~/.hasna` is a closed namespace
of app folders, and `XDG_CONFIG_HOME` is not consulted at all.

### Routing environment variables

| Variable | Meaning |
|---|---|
| `HASNA_SKILLS_API_KEY` | The API key (tier 5 of the ladder). The silent alias `SKILLS_API_KEY` is accepted for one release. |
| `HASNA_SKILLS_API_URL` | The Skills API origin (HTTPS, or loopback HTTP). The silent alias `SKILLS_API_URL` is accepted for one release. |
| `HASNA_SKILLS_LOCAL` | Explicit unhosted opt-in: run on this machine against owned drafts and the verified cache when no authority is configured. Any non-blank value (`1`). Alias `SKILLS_LOCAL`. Ignored whenever an authority or credential variable IS set. |
| `HASNA_SKILLS_API_KEY_OVERRIDE` | Deliberate tier-2 key that outranks every store. |
| `HASNA_SKILLS_API_KEY_REF` | Deliberate tier-2 vault-item pointer (resolved through `@hasna/secrets`). |
| `HASNA_PROFILE` | Selects an isolated `credentials-<profile>` file (tier 1). |
| `HASNA_STATION` | The Keychain account for tier 3; falls back to `hostname -s`, then `$USER`. |

## CLI Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `skills` | | Interactive TUI to browse, search, and pin skills |
| `skills pin <name>` | | Pin one or more skills in `.skills/project.json`; no source is copied |
| `skills pin --category "Development Tools"` | | Pin all skills in a category |
| `skills unpin <name>` | | Remove a project pin |
| `skills pins list` | | List pinned skills |
| `skills setup --api-url <url>` | | Point the CLI at a Skills API origin for remote runs |
| `skills setup` | | Show whether an API origin is configured; with none, running on this machine requires `HASNA_SKILLS_LOCAL=1` |
| `skills setup agents` | | Register the Skills MCP server with all supported agents |
| `skills list` | `ls` | List available skills (filter with `-c`, `--pinned`, `-t`, `--brief`) |
| `skills search <query>` | `s` | Search by name, description, or tags |
| `skills info <name>` | | Show metadata, env vars, and system dependencies |
| `skills show <name>` | | Show account or owned portable skill details |
| `skills docs <name>` | `--file skill\|readme\|claude` | Show preferred documentation; an explicit file must exist and unknown aliases fail |
| `skills requires <name>` | | Show env vars, system deps, and npm dependencies |
| `skills profiles show <id>` / `skills profiles set <id> --file <json>` | | Read an exact shared selection or update it with writer authorization |
| `skills install [name@version] --selection-profile <id>` | | Cache selected immutable bundles; without names, sync the profile |
| `skills load <name> --selection-profile <id>` | | Load complete instructions from the verified selection |
| `skills context <prompt> --selection-profile <id>` | | Resolve instructions matching the prompt and profile triggers |
| `skills hook install --agent all --selection-profile <id>` | | Plan one CLI bridge plus supported native hooks; `--apply` installs it, then restart and trust the hooks |
| `skills sessions show <id> --json` | | Inspect one session's exact profile revision and receipt hash without loading payloads |
| `skills sessions reconcile <id> --from-profile <id> --from-revision <rev> --receipt-sha256 <sha> --selection-profile <id> --profile-revision <rev>` | | Plan an explicit migration of one live session; `--apply --plan-digest <digest> --plan-issued-at <time> --plan-expires-at <time>` (within five minutes) preserves its old receipt and applies the reviewed replacement |
| `skills hook agents --json` | | Report maintained adapters and explicit coverage limits |
| `skills migrate native` | | Inventory native copies; `--apply` archives managed copies, with explicit `--include-unmanaged`, `--include-vendor`, or reviewed `--target-manifest` selection |
| `skills pull --all --selection-profile <id>` | | With CLI loading active, refresh the selected profile into the verified cache |
| `skills review-export <slug@version> --output <path>` | | Export one immutable hosted bundle to a private archive for review without selecting it |
| `skills sync --selection-profile <id> [--check] [--station <id>]` | | Sync or check the selected profile/cache; optionally record station state |
| `skills station-state <id>` | | Read a station's sync receipt in the authenticated workspace |
| `skills run <name> [args]` | | Execute a skill directly |
| `skills run --target cloud --selection-profile <id> <name@version>` | | Submit an explicitly selected cloud execution |
| `skills executions show <id>` / `logs <id>` / `artifacts <id>` | | Inspect a cloud execution and its output |
| `skills executions download <id> <artifact> --output <path>` | | Download and verify one cloud execution artifact |
| `skills runs status <run-id>` | | Poll a remote skill run |
| `skills exports download <run-id>` | | Download completed remote artifacts |
| `skills update` | | Refresh project pin metadata |
| `skills diff <name>` | | Compare pin metadata against the active registry |
| `skills init` | | Generate `.env.example` and update `.gitignore` for pinned skills |
| `skills categories` | | List all categories with skill counts |
| `skills tags` | | List all unique tags with occurrence counts |
| `skills doctor` | | Check env vars, system deps, and pinned skill health |
| `skills env-check [name]` | `check-env` | Show required environment variables; `--set KEY=VALUE` updates the project's `.env` |
| `skills test [name]` | | Test skill readiness (env, system, npm deps) |
| `skills outdated` | | Compare pinned vs registry versions |
| `skills login` | | Sign in in the browser (https://skills.md unless a server is configured); `--device`, `--email`, `--api-key` (stdin) and `--url <origin>` select other flows and servers |
| `skills logout` | | Sign out the active profile: delete the key `skills login` stored and revoke it on its server when login minted it; `--revoke` also revokes a key you added, `--no-revoke` revokes nothing (and exits non-zero if a minted key is left live) |
| `skills whoami` | | Show the signed-in account and where its credential came from |
| `skills auth login` / `auth logout` / `auth whoami` | | The same commands under `auth`; `auth login --membership-id` enrolls a workspace profile |
| `skills billing status` | | Show server account plan and balance |
| `skills billing checkout` | | Create a checkout session when billing is enabled |
| `skills billing portal` | | Create a customer portal session when billing is enabled |
| `skills credits buy <pack-id>` | | Create a credit-pack checkout session when billing is enabled |
| `skills setup-info` | | Version, pinned skills, agent configs, paths |
| `skills export` | | Export pinned skills as JSON |
| `skills import <file>` | | Pin skills from a JSON export |
| `skills config set <key> <value>` | | Set default agent, scope, output format, or API origin |
| `skills config unset <key>` | | Remove a configuration value (`skills config unset apiUrl` clears the stored service address and returns to running on this machine) |
| `skills new <name>` | `scaffold` | Scaffold a portable skill under `~/.hasna/skills/installed/<name>` |
| `skills port <path>` | `add` | Import an existing skill folder into the portable standard |
| `skills create <name>` | | Scaffold a new custom skill directory |
| `skills prepare <name> --version <semver>` | | Validate an edited draft and update only its manifest version/hash; `--dry-run` previews, `--kind` resolves legacy manifests without an explicit kind |
| `skills sync --to claude` | | Disabled by design; use `skills mcp --register <agent|all>` |
| `skills sync --from claude` | | Disabled by design; agent skill folders are not used |
| `skills sync [names...] --check --for <agent> --source <path>` | `render` | Legacy native-folder mode only, without CLI loading or a selection profile: check the selected corpus and agent homes without writing. Unknown selections or drift exit nonzero. |
| `skills sync --station <id>` | | Without CLI loading or a selection profile, legacy snapshot mode writes a v3 sync-manifest under `resources/<station>/skills` only with `--populate`; use explicit `--selection-profile` for API station receipts |
| `skills hydrate --station <id>` | | Restore the canonical corpus cache from a reviewed per-station snapshot (dry-run by default; `--apply` writes) |
| `skills validate <name>` | | Check a skill's directory structure |
| `skills schedule add <skill> <cron>` | | Set up recurring skill execution |
| `skills schedule list` | | List all schedules (enabled/disabled/last run) |
| `skills storage status` | | Show local state paths and optional repo-native storage readiness |
| `skills storage sync-plan` | | Plan `.skills` Postgres/S3 snapshot sync without network access |
| `skills mcp` | | Start MCP server on stdio |
| `skills mcp --register claude` | | Register the Skills MCP server in an agent config (also `codex`, `gemini`, `opencode`, `all`) |
| `skills self-update` | | Update this package to the latest version |
| `skills completion <shell>` | | Generate shell completions (bash, zsh, fish) |

`self-update` asks the same Bun executable for its global bin directory after a
successful installation. It reports success only when the `skills` command on
your PATH resolves to that installed command and exits successfully with one
semantic version. If discovery or verification fails, it exits nonzero and
explains that installation may already have completed. It does not automatically
reinstall or change your PATH.

### Exact-version runtime updates

`skills self-update --version 0.10.34` installs a verified package into a retained
copyfile runtime, preserves configuration and launcher preimages, and keeps the
previous runtime available for receipt-bound rollback.

Every launcher the updater switches (`skills`, `skills-mcp`, `skills-serve`,
`skills-server`, `skills-worker`, `skills-maintenance` and `skills-migrate`, in each
PATH directory it manages, and every alias `--adopt-aliases` switches) is written as a
pinned launcher, not a bare symlink. It is a `#!/bin/sh -p` file: the shell ignores
exported functions and `SHELLOPTS`-style settings from your environment, and the
updater refuses with `LAUNCHER_SHELL_UNSUPPORTED` before writing anything when
`/bin/sh` does not accept `-p` (for example dash older than 0.5.11). The launcher
execs the exact Bun binary that ran the update with
`--config=/dev/null --no-env-file --no-macros --no-install --cwd=<runtime version root>`
on the exact entry, through `env -i` with an explicit environment allowlist:
`HOME`, `PATH`, `TMPDIR`, `USER`, `LOGNAME`, `SHELL`, `TZ`, `LANG`, terminal names
(`TERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `COLORTERM`, `COLUMNS`, `LINES`),
`NO_COLOR`, `FORCE_COLOR`, `CI`, `EDITOR`, `VISUAL`, `PAGER`, `SSH_AUTH_SOCK`,
`DATABASE_URL`, the server settings `HOST`, `PORT`, `NODE_ENV`, `AGENT_ID` and
`ECS_CONTAINER_METADATA_URI_V4`, the agent names `TERMINAL_CWD`, `CODEX_HOME`,
`HERMES_HOME` and `HERMES_ENABLE_PROJECT_PLUGINS`, and every name starting with
`HASNA_`, `SKILLS_`, `SKILL_`, `MCP_`, `XDG_`, `LC_` or `AWS_`. Your `LC_ALL` passes
through unchanged. Everything else never reaches the runtime, including `BUN_*`,
`NODE_OPTIONS`, `DYLD_*`, `LD_*`, `NODE_EXTRA_CA_CERTS` and the proxy variables
(`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`). A `bunfig.toml`, `.env` or `tsconfig.json`
in the directory you run a command from is never read.

Each of those entries (the CLI, the MCP server, the API server, the worker,
maintenance and migrate) returns to your directory before anything else runs, so
relative paths keep working, including a relative `HASNA_SKILLS_DATABASE_URL`. When
the CLI starts another copy of itself (the hook's context lookup and its
`SessionStart` sync), the child gets the same Bun flags, the runtime version root as
its working directory and the same environment allowlist, and also returns to your
directory first. The receipt records the old and new launcher shape of every path,
the backup keeps the exact previous launcher (symlink text or pinned bytes), and
`--rollback` restores it byte for byte. Codex hook trust, the Claude settings
projection and `skills self-update` read a managed pinned launcher as the exact
entry it runs and bind the launcher's own bytes as well.

An updater from before pinned launchers (0.10.48 and earlier) writes bare symlinks,
including when it installs a version that has them, and an exact-version update to
the version already installed is refused. `skills self-update --adopt-aliases` pins
those launchers in place: in `~/.local/bin`, `~/.bun/bin`, `/opt/homebrew/bin` and
`/usr/local/bin`, a bare symlink that already reaches the current runtime's entry is
adopted like an alias still pointing at an older install. The same refusals apply
(an unsafe or unwritable directory, a launcher owned by another account, a foreign
file, an unsupported link chain), the exact symlink is kept as
`<launcher>.skills-alias-prev-<receipt id>`, the receipt records it as the old
`symlink` shape, and `--rollback-aliases <receipt id>` restores it exactly. A
launcher already pinned to the current runtime is left unchanged. Undo in reverse
order: roll back the adoption before rolling back the runtime update that wrote
those symlinks, because that update's `--rollback` refuses with
`LAUNCHER_DRIFT_ROLLBACK_REFUSED` while the adopted pinned launchers are in place.

To require a minimum dependency age, pass a positive integer number of days and
repeat the exclusion option for package names or package globs:

```bash
skills self-update --version 0.10.34 --min-release-age 7 \
  --min-release-age-exclude '@hasna/*' \
  --min-release-age-exclude '@hasna-internal/*' \
  --min-release-age-exclude '@openai/*' \
  --min-release-age-exclude '@anthropic-ai/*' \
  --min-release-age-exclude openai
```

The policy reaches both dependency lock resolution and `npm ci` through private
npm configuration. Exemptions match each dependency's own package identity;
unrelated transitive dependencies retain the minimum age. These options require
an exact version and npm 11.19.0 or newer with both age capabilities. They are
refused for rollback, alias adoption or the no-argument updater. Existing ambient
npm settings and credentials are not forwarded. Omitting the policy preserves
existing exact-version update behavior.

### Local environment assignments

`skills env-check --set 'KEY=value'` writes one literal value to the current
project's `.env`. Keys must match `[A-Za-z_][A-Za-z0-9_]*`. Empty values and `=`
within a value are supported; output confirms the key and path without printing
the value. Quote the shell argument when it contains shell metacharacters.

The writer preserves unrelated lines, comments, line endings and existing file
permissions. New files use mode `0600`. Symlinks and special files are rejected.
Values containing control characters, newlines, all three quote delimiters, an
odd trailing backslash, a backslash immediately before a final dollar, or a
backslash together with both a single quote and a backtick are rejected because
literal Bun dotenv serialization is not supported
for those cases. Multiline or ambiguous existing assignments also
require manual editing; refusal leaves the file unchanged. Literal round trips
are tested with Bun 1.3.14 and 1.4.0.

### Common Options

- `--json` — Output as JSON (pipeable)
- `--brief` — One-line format
- `--limit <n>` — Cap human rows where supported; use `--limit all` or `--limit 0` for every row
- `--cursor <n>` — Continue human-output pagination from a numeric offset
- `--remote` — Read browse/search data from the configured Skills instance (see **Credentials**)
- `--dry-run` — Preview without applying changes
- `--verbose` — Debug logging globally; richer human discovery rows where supported
- `--no-color` — Disable ANSI colors
- `-o, --overwrite` — Refresh existing pin metadata

### Compact Output Defaults

Agent-facing discovery commands are compact by default. `skills list --all`,
`skills search <query> --all`, `skills tags`, `skills runs list`, and
`skills schedule list` cap human output and print a next-page command when more
rows are available.

Use explicit disclosure controls when you need more:

```bash
skills list --all --limit 50
skills list --all --cursor 50 --limit 50
skills list --all --limit all
skills list --all --verbose
skills show logo-design
skills search pdf --json
```

CLI `--json` output remains the machine-readable full result for browse/search
commands. Human output is optimized for terminals and agent context.

### JSON Output Contracts

Commands that support `--json` write exactly one JSON value to stdout and keep
human diagnostics off stdout. Error cases set a non-zero exit code and return an
object with an `error` field where the command shape is not already an array.

Stable command shapes:

- Browse: `list`, `search`, `categories`, `tags` return arrays.
- Skill details: `info`, `docs`, `requires`, `validate`, `diff`, `test`,
  `doctor`, `auth`, `whoami`, and `outdated` return command-specific objects or
  arrays documented by their field names.
- Project state: `pin`, `unpin`, `update`, `init`, `import`, `create`, `new`,
  `scaffold`, `port`, `add`, and `sync` return result objects/arrays; `--dry-run --json` returns
  `{ "dryRun": true, "actions": [...] }` where applicable.
- Runtime: `run --json <skill> ...` returns
  `{ "skill", "args", "exitCode", "stdout", "stderr", "error", "run" }`.
  Server-owned (premium) runs include `{ "contractVersion": 1, "remote": true,
  "remoteRun", "run", "nextActions" }` and return immediately with
  status commands such as `skills runs status <run-id>` and
  `skills exports download <run-id>`. Premium-catalog and pricing metadata is
  served by the API and never ships in this package.
- Config and schedules: `config * --json` and `schedule * --json` return
  machine-readable status objects.
  `schedule run` exits 1 if any item fails, in human and JSON output. JSON
  `results[].attempted` identifies items handed to the local executor; `ran`
  counts those attempts, including failures. Missing skills, routing refusals,
  and unsupported hosted scheduling leave that occurrence due and its history
  unchanged. Local attempts record success/error and advance the schedule.
  If history cannot be saved, the item reports `executionStatus` and
  `historyError`; inspect its effects before retrying. Other due items still run.
  No-due and `--dry-run` remain successful without consuming occurrences.
  With `schedule run --json`, child stdout and stderr stream to stderr while
  stdout contains only the command's JSON result. Human-mode child output is
  unchanged. Programmatic `runSkill` callers can select `stdio: "stderr"` to
  stream both child output channels to stderr without buffering; the existing
  default/inherit and pipe modes retain their behavior.
- Storage: `storage status --json` returns local `.skills` paths and optional
  repo-native remote readiness; `storage sync-plan --json` returns a no-network
  snapshot plan.
- MCP registration: `mcp --register <agent> --json` returns
  `{ "registered": number, "results": [...] }`.

## Query a caller-owned catalog

The package root exports category and tag helpers that accept a readonly catalog:

```ts
import { getSkillsByCategory, getSkillsByTag, getAllTags } from "@hasna/skills";

const catalog = [
  { name: "write-brief", category: "Writing", tags: ["Research", "Writing"], credits: 5 },
] as const;

const writing = getSkillsByCategory("Writing", catalog);
const research = getSkillsByTag("search", catalog);
const tags = getAllTags(catalog); // ["research", "writing"]
```

An explicit catalog, including `[]`, is queried without loading local configuration
or installed skills. Category matching is exact; tag matching is a case-insensitive
substring search. An empty tag query matches records with at least one tag.
Filtered arrays keep the original record references, types and extra fields.
Omitting the catalog, or passing `undefined`, retains the configured local registry.

## Remote Registry

The npm package ships no skill corpus. Authenticated discovery reads the
account catalog. Explicit local mode reads owned drafts and verified downloads.
A failed hosted read never substitutes local content. To point at your own
instance:

```bash
export HASNA_SKILLS_API_URL=https://your-server.example
# or persist it in the credentials file the shared ladder reads:
skills setup --api-url https://your-server.example
# and to stop using it:
skills config unset apiUrl

skills list --remote --json
skills search transcribe --remote --json
skills categories --remote
skills tags --remote --json
```

If the URL is an origin such as `https://your-server.example`, the CLI requests
`/api/v1/skills`. If it already ends in `/api` or `/api/v1`, the CLI appends
`/skills`.

Authenticated registry listing and premium server-side execution use whichever
credential the ladder resolves — most often the one saved by
`skills auth login --api-key`.

The typed `RemoteSkillsClient` also exposes pin, tag, and cursor-based
incremental-sync methods (`listPins`/`pin`/`unpin`, `listTags`/`skillsByTag`,
`listUpdatedSince`). A server that predates those routes fails closed with an
explicit unsupported-route error — never a silent empty listing. Route table
and version-skew contract: `docs/architecture/remote-client-pins-tags-sync.md`.

For the reusable upstream contract, see
`docs/architecture/reusable-skills-engine.md`.

### Recurring consent SDK

The SDK exposes `previewRecurringConsent`, `getRecurringDraft`,
`activateRecurringConsent`, `listRecurringConsents`, `getRecurringConsent`,
`listRecurringOccurrences` and `revokeRecurringConsent`. These require a server
that explicitly advertises the version-1 recurring capability; an unavailable
server raises `RemoteRecurringUnavailableError`. This client does not create
local schedules or enable a server policy. Use `createRemoteSkillsClient` for the
existing selected-profile/API binding, or construct `RemoteSkillsClient` with an
explicit bearer and API URL. Each operation captures that connection and all
inputs before asynchronous work. An optional final `RemoteWorkspaceContext`
restricts it to an observed user and membership; profile files are unchanged.

`RecurringRequest` carries explicit cadence, lifetime, runtime limits and credit
and occurrence ceilings. A preview returns immutable terms, their hash, the
original quote and approval deadline; its quote states that admission reprices.
Draft retrieval retains those values even after expiry and never refreshes the
deadline. Activation requires the original draft ID and `RecurringActivation`:
`contractVersion: 1`, its exact `acceptedTermsSha256`, the literal acceptance
`authorize-recurring-credit-use`, and a caller-owned idempotency key. The client
reads the stored draft before submitting; the server independently requires
current fresh human authority. Client metadata cannot grant that authority.
Read operations require `schedules:read`, while preview and revocation require
`schedules:manage`; API keys cannot activate a grant. Consent read/history/revoke
preserve tenant-wide control, including retained grants from other deployments.

`RemoteRecurringUnconfirmedError` means a dispatched mutation could have
committed. Keep its original server/account, inputs, terms hash and request key;
explicitly reconcile that same identity with current authority. The client never
retries a POST, creates a replacement key or asserts rollback. After uncertain
revocation, inspect the original consent and occurrences; revocation does not
promise cancellation of an already authorized attempt. Exact domain not-found
responses return `null` only for draft/consent reads. Malformed or oversized
responses fail closed. Pages accept 1–100 items and an opaque cursor; a large
terms page can exceed the 64-MiB response bound, so request a smaller page
explicitly. JSON input is limited to 1 MiB and 64 nesting levels. Dashboard
approval and server enablement remain separate from these client interfaces.

### Recurring consent from the terminal or MCP

`skills recurring` uses the same hosted SDK methods. Existing `skills schedule`
commands retain their local metadata and one-shot behavior. A compatible server
must already support recurring consent; these commands install no server policy,
daemon or default key scopes. Read/draft/history require `schedules:read`, and
preview/revocation require `schedules:manage`.

| Command | MCP tool |
| --- | --- |
| `recurring preview --request <file>` | `preview_recurring_consent` |
| `recurring draft <draft-id>` | `get_recurring_draft` |
| `recurring activate <draft-id>` | `activate_recurring_consent` |
| `recurring list` / `recurring get <consent-id>` | `list_recurring_consents` / `get_recurring_consent` |
| `recurring occurrences <consent-id>` | `list_recurring_occurrences` |
| `recurring revoke <consent-id> --confirm` | `revoke_recurring_consent` |
| `recurring recover --recovery-dir <original-directory>` | `recover_recurring_consent` |
| `recurring verification <draft-id> --email <email> --confirm` | `request_recurring_verification` |

Use the CLI's existing `--profile <name>` before the command, or the MCP host's
explicitly configured connection. Fresh approval needs an enrolled workspace
profile or both observed `--user-id` and `--membership-id`; those IDs restrict
current authority. The target, profile and credential are captured before prompts
and checked again before changes. No operation switches or overwrites saved
credentials. A normal API-key login alone cannot activate recurring spend.
Before requesting or verifying a code, the client checks the selected key's
current account email, trimming whitespace and ignoring case as the server does.
A different email is refused before the login endpoint can create an account.

The request file contains every explicit `RecurringRequest` field, including
JSON input/args, runtime and connector limits, cadence/start/expiry/grace, UTC-day
period, finish-authorized-attempt policy, all three credit ceilings and both
occurrence ceilings. No policy values are inferred. Preview and draft retrieval
show the original server terms/hash, quote, first due instants and approval
deadline. They create no run or credit reservation. Each grant adds its own
budget; an occurrence reprices within the approved limits.

To activate, provide `--accepted-terms <original-sha256>`,
`--idempotency-key <original-key>`, `--recovery-dir <new-absolute-directory>`,
`--email <email>` and `--confirm`. A terminal displays the complete immutable
draft and requires typing `authorize-recurring-credit-use`, then requests a
fresh code and reads it masked. For JSON or noninteractive use, also supply
`--acceptance authorize-recurring-credit-use --code-stdin`; request the code
first with `recurring verification`. Do not put the code or session in argv.
Cancellation/EOF does not grant consent. The server independently verifies fresh,
eligible, non-impersonated human authority and the original terms.

MCP activation takes the same original draft, approval object, recovery directory
and explicit `confirm: true`, plus account email and a fresh code. The MCP host
may retain supplied code arguments in its history; the masked terminal flow
avoids that disclosure. No tool returns or stores the resulting session. A tool
confirmation boolean or API key never substitutes for verified human approval.

Activation and revocation require a new recovery directory under an existing
canonical parent. It is created privately and contains the original server,
profile, account/membership, draft/hash/approval key or consent ID and attempt
state. It contains no bearer, OTP or raw input payload. Preserve it after errors;
unknown mutation outcomes exit 2 in the CLI and set MCP `isError` with
`outcomeUnknown: true`. Read-only `recover` never resubmits. Explicit
`recover --confirm` reuses the original activation key/terms and fresh approval,
or the same revoked consent; it never creates a replacement request. An expired
draft or lost current authority does not resolve an earlier unknown outcome.
Aliased, replaced, malformed or locked recovery directories refuse changes.

List/history expose one page (1–100 items, default 20) and the unchanged opaque
cursor. Consent output includes period/total reserved and settled credits,
admitted counts, ceilings, deployment and next due time; history includes stable
occurrence/run IDs, outcomes, refusal reasons and allocation state. All hosts
read the same server identities. Revocation reports residual authorized exposure
and does not promise cancellation/refund of an already authorized attempt.
Cancellation is separate. A lost preview response has no draft lookup key:
report that uncertainty and explicitly choose any new preview, without silently
turning it into an activation.

## Portable Skills

Portable skills live under `~/.hasna/skills/installed/<name>/` and follow the
standard documented in `docs/skill-standard.md`.

```bash
skills new my-skill
skills validate my-skill
skills run my-skill --help
skills show my-skill

skills port ./existing-skill
```

New and imported local skill names use hyphens: `MyHTTPTool` becomes
`my-http-tool`, and `my_tool.v2` becomes `my-tool-v2`. Existing installed names
and declared command names remain readable without renaming. Already joined
lowercase words are not split automatically; supply `--name my-skill` when importing.
An import updates name declarations in its copied files; original source files stay unchanged.

Single-folder `port` / `add` reports validation after importing. If validation
fails, both human and JSON output exit with status 1; the imported folder remains
available for correction. Check `valid` and `issues` in JSON before using it.

The scaffold includes `SKILL.md`, `skill.json`, `AGENTS.md`, `package.json`,
`tsconfig.json`, and `src/index.ts`. `AGENTS.md` is written for coding agents:
after `skills new my-skill`, an agent can open that file, implement the skill,
update the manifest, run tests, and verify with `skills validate`.

## MCP Server

```bash
skills mcp    # stdio transport (use with Claude/Codex MCP config)
```

### HTTP mode

Long-lived Streamable HTTP transport (default port **8836**, bind `127.0.0.1` only):

```bash
skills-mcp --http
# or
MCP_HTTP=1 skills-mcp

# override port
skills-mcp --http --port 8836
MCP_HTTP_PORT=8836 skills-mcp --http
```

Endpoints: `GET /health` → `{"status":"ok","name":"skills"}`, MCP at `/mcp`.
Uses stateless `StreamableHTTPServerTransport` (shared process, many clients).
`skills-mcp` without flags still uses stdio (unchanged).

The MCP server's tools include `list_skills`, `search_skills`,
`scaffold_skill`, `port_skill`, `pin_skill`, `unpin_skill`, `pin_category`,
`list_pinned_skills`, `get_skill_info`, `get_skill_docs`, `get_requirements`,
`run_skill`, `get_run_status`, `schedule_skill`, `detect_project_skills`,
`validate_skill`, and more.

MCP discovery and status tools use compact paged envelopes by default:
`list_skills` and `search_skills` return `skills` plus `total`, `offset`,
`limit`, and `nextOffset`; `list_schedules` returns the same metadata with a
`schedules` array. `run_skill` returns
stdout/stderr previews and compact run summaries unless the caller passes
`detail: true`. Use `get_skill_info`, `get_skill_docs`, or `detail: true` for
full records only when needed.

### Register with an Agent

```bash
skills mcp --register claude    # Auto-register with Claude Code
skills mcp --register all       # Register with all supported agents
```

## Skills API

Use a named profile for each independently operated instance. A commercial Skills instance
and an internal instance have separate credentials, accounts,
credits and data. Selecting one does not change another profile or the fleet
resolver's existing defaults. `run --remote` uses that instance's catalog and
credit approval flow even on a managed station. It cannot be combined with
`--target local` or `--target cloud`; without `--remote`, managed selection
and execution defaults continue to apply. MCP `run_skill` with `remote: true`
uses the same hosted approval flow and cannot also specify `target`.

```bash
# Configure the commercial instance before signing in.
skills --profile customer setup --api-url https://skills.example.com/api/v1 --json
skills --profile customer auth signup --email you@example.com --json
skills --profile customer auth login --email you@example.com --code <CODE> --json
skills --profile customer auth whoami --json
skills --profile customer capabilities --json
skills --profile customer list --remote --json

# Quote without spending. Put CLI flags before the skill name.
skills --profile customer quote --json blog-article --topic "Your topic"
skills --profile customer run --remote --yes --wait --json --idempotency-key article-001 blog-article --topic "Your topic"
skills --profile customer runs status <run-id> --json
skills --profile customer runs logs <run-id> --json
skills --profile customer runs artifacts <run-id> --json
skills --profile customer exports download <run-id> --json

skills --profile customer billing status --json
skills --profile customer billing usage --json
skills --profile customer billing invoices --json
skills --profile customer credits packs --json
skills --profile customer credits buy <pack-id> --idempotency-key checkout-001 --json
skills --profile customer billing portal --json
skills --profile customer auth keys list --email you@example.com --code <FRESH-CODE> --json
# Request a fresh OTP, then create a separately scoped key (shown once).
skills --profile customer auth signup --email you@example.com --json
skills --profile customer auth keys create automation --email you@example.com --code <CODE> --scope runs:read --json
skills --profile customer auth logout --json
```

For credit checkouts, generate and retain a unique request key **before** calling.
The SDK accepts `createCreditCheckout(packId, { idempotencyKey })`; MCP
`create_credit_checkout` accepts `idempotency_key`. Success and bounded checkout
errors retain `requestIdempotencyKey`. An omitted key is generated before the
single POST, but an explicit saved key is needed if the client process exits
before returning any result. Recover only on the same server, account and pack.
No surface retries a checkout automatically. For unresolved or in-progress
outcomes, inspect billing and explicitly reuse the same key after any indicated
wait. Expired or fulfilled outcomes need a deliberate decision, not a fresh key
on an automatic retry. The provider's derived `idempotencyKey` is not the request
key. This protocol requires the configured server to honor checkout idempotency;
older servers can return a link without proving durable recovery semantics.

An origin, a full `/api/v1` base and a base with a path prefix normalize to the
same routes. `HASNA_PROFILE=customer` selects the same profile as `--profile`.
`HASNA_SKILLS_API_URL` (or the compatible `SKILLS_API_URL`) is an explicit URL
override, not permission to send a saved key to a different instance. Stored
keys retain their original instance binding; sign in to a separate profile to
switch instances. `HASNA_HOME` / `HASNA_CONFIG_HOME` isolate credential state;
`HASNA_SKILLS_DIR` separately isolates corpus/configuration data. They do not
require changing `HOME`.

Private source publication uses a separate hosted contract advertised by
`capabilities.privatePublishing`. It requires fresh email verification, an
existing private/team skill UUID, and an explicit comparison with the observed
current version UUID (or `--expect-empty`). Request a code with `auth signup`
first, then enter it over stdin; do not put verification codes in shell history.

```sh
skills --profile customer publication publish ./my-skill \
  --skill-id <skill-uuid> --expect-empty --recovery-dir "$PWD/publication-receipt" \
  --email you@example.com --code-stdin --confirm --json
skills --profile customer publication status --recovery-dir "$PWD/publication-receipt" \
  --email you@example.com --code-stdin --json
```

Without an enrolled named profile, also supply the observed `--user-id` and
`--membership-id`. `publication resume` and `publication cancel` use the same
recovery directory, fresh verification, and `--confirm`. The directory must be
new for `publish`, have a canonical absolute parent path, and contain no symbolic
links. It keeps immutable archive bytes and a generated idempotency key before
the first publication request. Preserve it after interruption: resume reconciles
the same declaration, and an uncertain upload is never sent twice. If a process
crashes while holding `operation.lock`, confirm it has stopped before removing
that lock explicitly. Status and cancellation remain available when new
publishing is disabled. Exit 2 means publication is still pending; `committed`
means source was published. Execution requires a separate server quote and approval.
Publication recovery results report `executionEnabled: null` because their durable
receipts contain no server capability observation. Use `getCapability()` for the
server's current boolean capability; it does not authorize an individual run.

The SDK exports `RemotePrivatePublicationsClient` through both the root and
`./sdk`; `RemoteSkillsAuthClient.openPrivatePublications` creates one from fresh
workspace verification. The shared `preparePrivatePublication`,
`continuePrivatePublication`, `inspectPrivatePublication`, and
`readPrivatePublicationRecovery` functions implement the same durable workflow.
MCP exposes `publish_private_skill`, `get_private_publication`,
`resume_private_publication`, and `cancel_private_publication` with equivalent
explicit authority and consent. Recovery directories are local to the MCP host;
request history may retain supplied verification codes. Tokens and signed upload
URLs are never returned or written to the recovery directory.

A paid remote run requires explicit approval. Interactive runs ask before
submission; JSON and other noninteractive runs require `--yes`. The approved
quote becomes the server-enforced credit ceiling. A changed price above that
ceiling fails before admission. When the server returns `quoteReceipt`, the
client preserves that opaque value from the approved quote without obtaining a
replacement. The server checks its version, request and expiry binding; a refusal
stops the submission. A compatible server must advertise bounded
approval; older or unsupported APIs return errors, not local results. Reuse the
same idempotency key only for an identical submission to safely recover an
interrupted response. `runs cancel` and `runs resume` call the server's lifecycle
operations and can be refused when the current state does not allow them.

`run --remote --file input.txt ...` quotes the owned files' names, sizes, SHA-256
hashes and content types before approval, declares those same descriptors at
admission, and uploads the original bytes without forwarding the account key to storage. Failed uploads
request cancellation. Upload support must be advertised by the server.
Downloads verify authenticated size and SHA-256 metadata before writing files;
existing files and unsafe paths are refused. CLI/SDK downloads are bounded to
64 MiB; MCP inline artifacts and input files are limited to 1 MiB. Listing, creating and revoking API keys require fresh email OTP reauthentication; an existing
API key cannot grant new key authority. Checkout
commands return external links; payment confirmation remains in the browser.

The MCP server uses the same account, quote, run and artifact client. Agent
hosts must launch `skills-mcp --stdio`; the standalone default is loopback HTTP.
Configure its environment with the selected `HASNA_PROFILE` and isolated state
paths. `run_skill` accepts `remote:true`, `maxCredits`, `quoteReceipt`, `idempotency_key`, and
optional inline `files:[{name,base64,contentType}]`. An omitted ceiling permits
only free execution. `quote_skill` accepts the same input, args and inline files
and never submits a run. After approval, pass its receipt unchanged to `run_skill`
with those same values; do not automatically re-quote after a refusal.

```ts
import { RemoteSkillsAuthClient, createRemoteSkillsClient } from "@hasna/skills/sdk";

// Auth transports never write credentials; the embedding application owns storage.
const auth = new RemoteSkillsAuthClient("https://skills.example.com/api/v1");
await auth.requestCode("you@example.com");
// await auth.verifyCode("you@example.com", code);

// Uses the same selected profile and credential binding as CLI/MCP.
const client = await createRemoteSkillsClient(process.env);
if (!client) throw new Error("Configure an instance and sign in first");
const quote = await client.quoteRun("blog-article", {}, ["--topic", "Your topic"]);
// Obtain explicit user approval of quote.pricing.costCents before this call.
const run = await client.submitQuotedRun("blog-article", {}, ["--topic", "Your topic"], {
  maxCredits: quote.pricing.costCents,
  quoteReceipt: quote.quoteReceipt,
  idempotencyKey: "article-001",
});
```

`submitRun` remains a compatibility transport for servers implementing the legacy
submission protocol. This OSS server returns HTTP 410 (`LEGACY_EXECUTION_RETIRED`)
for unversioned submissions and never queues or executes them. Use a selected,
immutable executable version through `skills run <name>@<version> --target cloud`;
see [versioned cloud execution](docs/architecture/cloud-execution-runtime.md).
Historical run reads, logs, artifacts, and cancellation remain available.

On servers that implement paid submission, new integrations
should use `submitQuotedRun` or `submitQuotedRunWithFiles` so capability and
approval checks run before submission. Credit counts are integers; `maxCostCents`
is a legacy spelling for the same credit ceiling. An optional receipt is a
nonempty opaque string of at most 4,096 UTF-8 bytes, preserved without normalization.
`quoteRun` accepts optional file descriptors as its fourth argument; each descriptor
contains `name`, `sizeBytes`, `sha256`, and `contentType` and must match the later
submission. `submitQuotedRunWithFiles` captures owned bytes and derives these
descriptors before its asynchronous calls. Explicit receipts are never replaced;
without one, it requests a quote and carries the returned receipt into admission.
Missing billing capabilities
on an internal instance are explicit unsupported responses; this package does
not add a billing engine to the OSS server.

### Server database

The server supports SQLite and Postgres. The database is an adapter choice, not a
different product: the schema, the organization scoping, and the run lifecycle are
identical either way.

Set `SKILLS_PUBLIC_BASE_URL` to this server's public API origin before starting
`skills-serve` or embedding its SDK handler. The server uses that authority in
profile receipts; its socket address cannot establish the public URL. For a
local-only instance, use the loopback origin shown below. A deployed independent
instance should use its own HTTPS origin. Without an explicit public URL, the
server refuses to start before opening storage.

```bash
export SKILLS_PUBLIC_BASE_URL=http://127.0.0.1:8787
skills-serve                                              # SQLite at ~/.hasna/skills/server.db
HASNA_SKILLS_DATABASE_URL=<path>/server.db skills-serve
HASNA_SKILLS_DATABASE_URL=postgres://user:CHANGEME@host/skills skills-serve
```

> **Bin naming:** the canonical server bin is `skills-serve`; `skills-server` remains
> installed as a deprecated alias for one release (same entrypoint). `skills-worker`
> and `skills-migrate` are additional documented surfaces.

| `HASNA_SKILLS_DATABASE_URL` | Backend | Survives restart |
| --- | --- | --- |
| *(unset)* | SQLite at `<data dir>/server.db` | yes |
| `/path/to.db`, `sqlite:/path`, `file:///path` | SQLite at that path | yes |
| `postgres://…`, `postgresql://…` | Postgres | yes |
| `:memory:`, `sqlite::memory:` | SQLite, in memory | no |
| `memory:` | in-process map | no |
| `sqlite:`, `sqlite://host/p`, `mysql://…`, … | startup error naming what is supported | — |

An empty path (`sqlite:` — what `sqlite://${DB_PATH}` becomes when `DB_PATH` is
unset) and a host where a path belongs (`sqlite://srv/a.db`, one slash short of
`sqlite:///srv/a.db`) are configuration errors, not silently a scratch database or a
new empty file under the working directory.

The data directory follows `$HASNA_SKILLS_DIR`, so the database moves with the rest
of the app's state. The database file sits at the app root, beside `config.json` —
not inside `installed/`, which holds only the installed skill corpus.

One sharp edge: `HASNA_SKILLS_DATABASE_URL` is shared with the optional repo-native
storage sync under [Storage Boundary](#storage-boundary), and that sync speaks
Postgres only — it takes this variable's value as given rather than checking it. If
you point the server at a SQLite path and also use `skills storage sync-plan`, set
the sync's database separately. The two are independent features that happen to
read the same name.

SQLite applies pending migrations when the server opens the database, so a single
operator needs no separate migrate step. Postgres deployments run migrations
explicitly, because several replicas racing to migrate one shared database is not
something to do implicitly:

```bash
HASNA_SKILLS_DATABASE_URL=postgres://user:CHANGEME@host/skills skills-migrate
```

`skills-migrate` fails if no database is configured rather than migrating a default
SQLite file, so it stays usable as a deploy gate.

`HASNA_SKILLS_DATABASE_URL` and `DATABASE_URL` are server-only. CLI, MCP, and SDK
clients never read them and never open a database connection: a client reaches
the cloud only through the resolved API URL plus the resolved API key (see
[Credentials](#credentials)). The one exception is the repo-native storage
sync under [Storage Boundary](#storage-boundary), an operator tool that
intentionally reads the same variables.

Three things the server will not do:

- Fall back to another backend when a configured Postgres URL cannot be reached.
  Degrading would leave your data split across two stores with no signal.
- Start against a reachable Postgres that has no schema. `/health` returning `ok`
  while the first API call 500s on a missing table is the failure this replaces.
- Start on a store that does not survive a restart, unless
  `HASNA_SKILLS_ALLOW_EPHEMERAL_STORE=1` says otherwise. The same guard applies to
  `skills-worker`.

**Durability is per-filesystem, not magic.** SQLite survives a process restart
against the same file — nothing more. A container without a persistent volume gets a
database in its own ephemeral layer, and two replicas each get their *own* database
rather than sharing one. Multi-replica and container deployments want Postgres; both
`skills-serve` and `skills-worker` print the database they opened on startup, so a
split-brain SQLite setup shows up as two different paths in the logs.

<a id="storage-boundary"></a>

## Storage Boundary

Hasna Skills is local-first. Project runtime state stays in `.skills/`; global
config and auth stay under `~/.hasna/skills/`.

Optional repo-native sync can be configured without a Skills API account:

```bash
HASNA_SKILLS_DATABASE_URL=postgres://...
HASNA_SKILLS_S3_BUCKET=skills-artifacts
HASNA_SKILLS_S3_PREFIX=opensource/prod/skills

skills storage status
skills storage sync-plan --schema-sql
```

Wrappers and deployment tooling can import the storage-only surface without
pulling in CLI/runtime helpers:

```ts
import { getStorageStatus, resolveStorageConfig } from "@hasna/skills/storage";
```

Plain `SKILLS_DATABASE_URL` and `SKILLS_S3_BUCKET` fallbacks are accepted for
local development. There is nothing to declare beyond these: on-box SQLite and
files are always there, and Postgres or S3 are used when, and only when, their
variables are set. Deployments should map runtime database and artifact settings
into `HASNA_SKILLS_*` so local CLI state cannot accidentally point at production
storage.

## Project Structure

```
src/
├── cli/index.tsx           # Commander.js CLI + Ink TUI
├── mcp/index.ts            # MCP server (stdio)
├── lib/
│   ├── registry-data/       # Empty compatibility export; no catalog content
│   ├── registry.ts          # Discovery over owned cache and explicit sources
│   ├── installer.ts         # Project pins and disabled source-copy paths
│   ├── project-state.ts     # .skills/project.json preferences
│   ├── run-state.ts         # .skills/runs and .skills/exports metadata
│   ├── skillinfo.ts         # Docs, requirements, env/system detection
│   ├── scheduler.ts         # Cron-based skill execution
│   ├── config.ts            # Global + project config loading
│   └── utils.ts             # normalizeSkillName()
├── index.ts                 # Library re-exports (npm package entry)
└── *.test.ts                # Test files
```

### Derived counts

| Count | Value | Derived from |
|---|---|---|
| Catalog skills | 0 | `SKILLS.length` (`src/lib/registry-data/`) |
| Categories | 17 | `CATEGORIES` (`src/lib/registry-types.ts`) |
| MCP tools | 82 | `tools/list` against a live `buildServer()` |

Every number in this table is re-derived from the source tree on each test run by
`src/lib/readme-derived-counts.test.ts`, so a drifted figure fails a test rather
than sitting on the front page. Counts are stated here and nowhere else in this
file for the same reason: this README advertised `202+` skills for weeks after the
catalogue was cut to 85, because the figure was hand-written in prose that nothing
checked.

## Project Runtime State

Skills are discovered from the configured server registry or the local corpus
cache (`~/.hasna/skills/installed`, filled by `skills pull`; a checkout can be
named explicitly with `skills sync --source <path>` or `$SKILLS_SOURCE`). The
npm package ships no bundled corpus. Project folders and agent-native skill
folders are never used as skill libraries.

`.skills/` is runtime/output state only:

```text
.skills/
├── project.json              # optional pins/preferences, no secrets
├── runs/YYYY-MM-DD/<run-id>/  # run.json, artifacts.json, events.ndjson, logs/
├── exports/<skill>/<run-id>/  # files produced by a run
└── tmp/
```

Auth stays global in `<app folder>/auth.json` (default
`~/.hasna/skills/auth.json`). Registry and doc caches
belong in `~/.cache/skills` or the Skills API, not inside project
`.skills`.

## Development

```bash
bun install
bun run build              # Build CLI, MCP, library, and types
bun run dev                # Run CLI in dev mode (no build needed)
bun test                   # Run all tests
bun run typecheck          # TypeScript type checking
```

## Adding a New Skill

1. Create `skills/{name}/` with `src/index.ts`, `package.json`, `tsconfig.json`, `SKILL.md`
2. Add an entry to the category file it belongs to under `src/lib/registry-data/`
   (`src/lib/registry.ts` re-exports `SKILLS` from there; it holds no entries itself)
3. Run `skills validate <name> --json` to check package metadata, portable
   manifests, bin entries, docs, and SKILL.md frontmatter
4. Run `bun test` to verify registry-wide validation passes

Server-owned (premium) skills declare the server-owned marker in their
published contract (`skills.runtime: "hosted"` or `skills.source: "remote" |
"private-hosted"`), ship public contracts, docs, and tests, and add no provider
secrets and no pricing metadata to the OSS package — pricing is served by the
API.

Portable skill directories are auto-discovered from
`~/.hasna/skills/installed/<name>/`. Skills found in either older location -
`~/.hasna/skills/<name>/` or `~/.hasna/skills/custom/<name>/` - are copied into
`installed/` on first use; the originals are left in place.
Project `.skills/` is reserved for runtime state and outputs.

## Data Directory

`~/.hasna/skills/` is the skills **app folder**. App data sits at its root and
the installed skill corpus lives in a named subfolder, matching every sibling
Hasna app (`mementos` has `agents/`, `accounts` has `profiles/`, `knowledge` has
`artifacts/`):

```
~/.hasna/skills/                    app folder
~/.hasna/skills/installed/<name>/   the corpus, one folder per skill
~/.hasna/skills/config.json         app data
~/.hasna/skills/skills.db
~/.hasna/skills/auth.json
```

Because the corpus has its own folder, a skill may be named `config`, `custom`, or
anything else without colliding with app data.

Project runtime data stays in `.skills/runs`, `.skills/exports`, `.skills/tmp`,
and optional `.skills/project.json`.

Set `HASNA_SKILLS_DIR` to relocate the **app folder**. Everything moves together
— the corpus is always `<app folder>/installed` — so there is one variable and one
coherent relocation. The legacy `~/.skills` migration is skipped for an
overridden folder. `skills config path` reports the config file actually in use.

| Path | Location | Moves with `HASNA_SKILLS_DIR` |
|---|---|---|
| Installed skills | `<app folder>/installed/<name>/` | yes |
| Global config | `<app folder>/config.json` | yes |
| Feedback database | `<app folder>/skills.db` | yes |
| Auth | `<app folder>/auth.json` | yes |

There is no separate local-skills-folder override, and none is needed: one
variable relocates the whole app folder, so the corpus is always
`<app folder>/installed`. With the default app folder that is exactly the
migrated corpus location — the former `~/.skills` and `custom/` trees are folded
into `<app folder>/installed` on first resolution (see "Migrating from the older
layout"). Extension corpora are a separate concern and keep their own
`extensionsDir` config key.

### Migrating from the older layout

Skills used to be written straight into the app root, and before that into
`custom/`. Both are folded into `installed/` automatically the first time the
corpus is resolved. The migration **copies and never deletes**, skips anything
already present under `installed/`, and leaves behind any directory that carries
none of a skill's identifying files (`SKILL.md`, `skill.json`, `package.json`) —
so run output and app data are not swept into the corpus. Once you have confirmed
`skills list --all` shows what you expect, the old directories can be removed by
hand.

## License

Apache-2.0 — see [LICENSE](LICENSE)

### Account and workspace names on a compatible server

`skills account update --display-name "Ana" --email you@example.com` and
`skills workspace update --name "Studio" --email you@example.com` request a
fresh verification email and prompt for the code without showing its digits.
The current API selection still determines the server. These commands require
that server to support the additive customer-name routes; they do not enable
membership, billing or operator administration.

For automation, first request a fresh code through `skills auth login --email you@example.com --json`,
then pipe the code from your secure input source to the same command with
`--code-stdin --json`. Do not put verification codes in command arguments or
shell history. JSON/noninteractive updates require `--code-stdin`. Cancelling
an interactive prompt exits with status130 before verification.

`RemoteSkillsAuthClient.updateProfile(email, code, { displayName })` and
`updateCurrentWorkspace(email, code, { name })` use a fresh session without
replacing saved API keys or profile selection. `RemoteSkillsClient` exposes the
same name operations for an explicitly supplied interactive session. Servers
retain the final permission checks; ordinary API keys may be refused. MCP tools
`update_account_profile` and `update_workspace_name` accept a name, email and
fresh verification code, and return only the safe updated projection.

## Admin user-list authority

The `./admin-contract` user-list response retains a global identity whose default
workspace membership is absent or revoked. Its required `role` is `null` in that
case, and its `organizationId` remains the default workspace pointer. Null grants
no workspace authority. Consumers must handle it explicitly; an organization
filter lists active members of that workspace. Role assignment still requires a
concrete role and targets the default membership; a missing default membership
does not select a different workspace automatically. Active organization rosters
and role-mutation responses continue to require non-null roles.

## Current workspace roster on a compatible server

`skills workspace members --email you@example.com` requests fresh email
verification and reads one page of the current workspace roster. The selected
server requires a current owner/admin session; API keys and support
impersonation do not grant roster access. It never replaces saved credentials
or changes the selected profile.

For noninteractive use, request a code with the existing auth flow, then supply
it on stdin (never as a command argument):

```sh
skills workspace members --email you@example.com --code-stdin --limit 25 --json
```

JSON includes `organizationId`, `members`, and required `nextCursor` (null on the
last page). Pass a returned cursor unchanged with `--cursor` to read the next
page; limits are 1–100 with server default 50. Timestamps retain the server's
microsecond strings. Human output also includes a continuation cursor when one
exists. Empty pages are distinct from denied, unsupported or malformed responses,
which fail the command.

SDK callers with an authorized customer session can use
`RemoteSkillsClient.listWorkspaceMembers({ limit, cursor })`. For fresh email
verification, use `RemoteSkillsAuthClient.listWorkspaceMembers(email, code,
options)`. The MCP tool `list_workspace_members` takes `email`, `code`, and
optional `limit`/`cursor` and calls the same fresh-auth client.

## Change a current workspace membership

On a compatible server, use the exact `membershipId` and role from the roster:

```sh
skills workspace member role <membership-id> --role viewer --expected-role member --email you@example.com --code-stdin --json
skills workspace member remove <membership-id> --expected-role viewer --email you@example.com --code-stdin --json
```

Both commands use fresh verification and leave saved credentials and profiles
unchanged. Without `--code-stdin`, an interactive terminal requests and prompts
for a new code. JSON and noninteractive calls require a previously requested
code on stdin. The server enforces current owner/admin policy. Owners can change
roles while retaining an owner; admins can manage another member/viewer within
those two roles. Self-removal is unavailable.

`RemoteSkillsClient.setWorkspaceMemberRole(membershipId, { role, expectedRole })`
and `.removeWorkspaceMember(membershipId, { expectedRole })` accept an explicit
customer session. The corresponding `RemoteSkillsAuthClient` methods take
`email, code` before those arguments and obtain an ephemeral session. MCP tools
`set_workspace_member_role` and `remove_workspace_member` use the same client,
with required `membershipId`, `expectedRole`, `email`, `code`, and `role` for a
role change. API keys and support impersonation do not grant this authority.

A role result contains `{ organizationId, member, changed }`; removal contains
`{ organizationId, membershipId, removed: true, alreadyRemoved }`. Exact server
timestamps remain strings. An authorized already-applied role returns
`changed: false`; retrying removal of the same tombstone returns
`alreadyRemoved: true`. A later replacement membership has a different ID.
Stale expected-role conflicts require a roster refresh before another action.
The client never refreshes, changes the precondition, or retries automatically.
Known refusals expose a fixed message and code through `RemoteWorkspaceMemberError`;
unsupported routes remain errors. Invitations, workspace switching and leaving
your own workspace are separate capabilities.

### Workspace profiles

Discover the workspaces available to your account using a fresh verification code:

```sh
skills workspace list --email you@example.com --code-stdin --json
```

Pipe the six-digit code to stdin. Interactive terminal requests can omit
`--code-stdin` to request and enter a masked code. Discovery saves no credential.
The current marker identifies the workspace initially chosen by sign-in; it does
not change your account's default workspace.

To enroll a workspace, choose its exact membership ID from that list and name
the destination credential profile explicitly:

```sh
HASNA_PROFILE=team-b skills auth login --membership-id <membership-id> --email you@example.com --code-stdin --json
HASNA_PROFILE=team-b skills auth whoami --json
```

This fresh sign-in creates one ordinary CLI API key in that workspace, verifies
its identity, and saves it only in the named profile. Existing keys and other
profiles stay bound to their original workspaces. Viewer memberships cannot
create keys. Session JWTs are never saved. Remove injected API-key overrides
before enrolling a profile so that later commands use the saved credential.
A profile belonging to a different account requires a different profile name
or an ordinary replacement login. New accounts must finish ordinary account
login before workspace enrollment; the server's existing signup policy applies.

Named-profile account/workspace name updates, roster/member actions, and API-key
management retain that profile's live workspace identity through fresh OTP
verification. A revoked key, unavailable membership, or inconsistent profile
metadata refuses the operation; it does not fall back to the default workspace.
The CLI cannot change your parent shell: keep `HASNA_PROFILE=team-b` on subsequent
commands or configure it explicitly in that shell. Existing MCP fresh-auth
account, member and key tools retain the same named profile authority for each
invocation. Changing an MCP host’s selected profile
through a tool remains a separate follow-up.

If enrollment reports that key issuance was attempted but not confirmed, inspect
the selected profile and workspace keys before retrying. A lost response can
still have created a server key; the CLI does not retry issuance automatically.

### Leave a workspace

Use the exact membership ID and observed role from fresh `workspace list` output.
Leaving requires deliberate confirmation and a fresh verification code:

```sh
HASNA_PROFILE=team-b skills workspace leave <membership-id> --expected-role member --email you@example.com --code-stdin --confirm --json
```

The selected profile must authenticate the same membership. Without a named
profile, supply `--user-id <user-id>` from discovery; this also supports viewers
who cannot create API keys. The server refuses stale roles, the last active
owner, and leaving your last available workspace. It decides authority atomically.

The SDK offers `RemoteSkillsAuthClient.leaveWorkspace(email, code,
{ userId, membershipId }, { expectedRole, confirm: true })`; an existing interactive
session can use `RemoteSkillsClient.leaveWorkspace(context, input)`. MCP exposes
`leave_workspace` with those same explicit IDs, role, confirmation and fresh code.
All surfaces call the same HTTP method once. API keys cannot authorize the leave.

Success returns `{ organizationId, membershipId, removed: true,
signInRequired: true }`. Sign in again to an available workspace afterwards.
Saved credentials and unrelated profiles remain unchanged; credentials for the
left membership no longer grant access. A lost or invalid response raises
`RemoteWorkspaceLeaveUnconfirmedError`: inspect available memberships before any
new action. Never automatically retry or substitute another membership ID.


## Workspace invitations

The SDK, CLI and MCP use the same invitation operations on your configured API.
A compatible hosted service must enable invitation delivery. Every operation
requires fresh verification bound to your observed user ID and current membership
ID; any named profile must match. Owners can invite all roles; admins manage only
member/viewer invitations. The server enforces current authority and verified
recipient email. Existing accounts with no available membership still need the
separate invitation recovery flow; these commands do not bypass ordinary login.

Use `skills workspace list` to observe the account and membership IDs. The
`workspace invitations` commands are `list`, `get <invitation-id>`, `issue`,
`resend <invitation-id>`, `revoke <invitation-id>` and `accept <invitation-id>`.
Each requires `--email`, `--user-id` and `--membership-id`. Mutations also require
`--confirm`. `list --after <nextCursor>` reads one additional page, at most 50
invitations; it never automatically traverses the account.

For `issue`, supply `--recipient`, `--role` and your own
`--idempotency-key <uuid>`. `resend` requires that key and
`--expected-generation`; `revoke` requires `--expected-generation`. Save the
request key with its original nonsecret context and parameters before issuing or
resending. A lost response is not proof of failure: read current invitations or
reconcile with exactly the same key and original parameters. Never replace the
key to retry an uncertain action. No command retries or rewrites saved profiles.

Read, issue, resend and revoke can read a previously requested six-digit code via
`--code-stdin`. Otherwise an interactive terminal requests a code and masks input.
Acceptance takes its invitation ID as the argument and reads the fresh code on
stdin line one and the 43-character invitation token on line two with
`--secrets-stdin`. Interactive acceptance masks both inputs. Do not put either
secret in arguments, environment variables, shell history, scripts or profiles.
Obtain both from your inbox and pass them through your terminal or an approved
secret-input mechanism. JSON/noninteractive acceptance requires `--secrets-stdin`.

Acceptance returns the joined organization and membership IDs. It does not change
the current workspace, default home, saved keys or profiles. Inspect your workspace
list and deliberately select a membership afterward. A delivery state of
`provider_accepted` means the provider accepted the request, not that it reached
an inbox.

Both SDK entrypoints export `RemoteSkillsClient` methods
`listWorkspaceInvitations(context, options?)`,
`getWorkspaceInvitation(context, invitationId)`,
`issueWorkspaceInvitation(context, input)`,
`resendWorkspaceInvitation(context, invitationId, input)`,
`revokeWorkspaceInvitation(context, invitationId, input)` and
`acceptWorkspaceInvitation(context, invitationId, { token, confirm: true })`.
The corresponding `RemoteSkillsAuthClient` methods prepend `email, code` to those
arguments for fresh verification. `context` is `{ userId, membershipId }`.
Issue input is `{ email, role, idempotencyKey, confirm: true }`; resend is
`{ expectedGeneration, idempotencyKey, confirm: true }`; revoke is
`{ expectedGeneration, confirm: true }`. Tokens and temporary sessions are never
returned in invitation projections or persisted by these methods.

MCP exposes `list_workspace_invitations`, `get_workspace_invitation`,
`issue_workspace_invitation`, `resend_workspace_invitation`,
`revoke_workspace_invitation` and `accept_workspace_invitation`. Supply explicit
`userId`, `membershipId`, `email` and fresh `code` in each tool request. Issue uses
`recipient` for the invitation email; acceptance's `token` travels only in the
MCP request. Treat the host's request history as sensitive; the tools never echo
that token or save it in a profile. Other mutation fields match the SDK.

Known server refusals are fixed `RemoteWorkspaceInvitationError` codes.
`WorkspaceInvitationInputError` rejects invalid inputs before authentication.
`RemoteWorkspaceInvitationReadError` refuses malformed, cross-workspace or
unbounded results. `RemoteWorkspaceInvitationUnconfirmedError` requires explicit
reconciliation of a mutation; it never triggers automatic replay. These adapters
require service and real recipient acceptance testing before invitations can be
offered as a live product capability.

### Content identity without extraction

`computeContentHashFromEntries` and `verifyContentHashFromEntries` are available
from the root package and `@hasna/skills/sdk`. They consume regular-file entries
such as the result of `inspectSkillBundle`, revalidate their shape and paths, and
copy their bytes before yielding. Neither function reads a directory, extracts
files, changes the supplied entries, or authorizes code execution.

```ts
import { inspectSkillBundle, computeContentHashFromEntries,
  verifyContentHashFromEntries, revisionIdOf } from "@hasna/skills/sdk";

const inspected = await inspectSkillBundle(uploadBytes, { signal });
const contentHash = await computeContentHashFromEntries(inspected.entries, { signal });
const verification = await verifyContentHashFromEntries(inspected.entries, { signal });
```

Verification reads `provenance.content_hash` from the same captured `skill.json`;
it cannot accept a second manifest in place of those bytes. Manifest field
validation remains a separate operation. `revisionIdOf` and `RevisionContent`
expose the existing revision identity, whose optional fields default to null and
whose published tag order matters. An archive SHA, canonical content hash and
published revision ID describe different identities and are not interchangeable.

The entry functions preserve the directory hash's coverage, LF normalization,
binary handling, manifest self-hash removal, ordering and serialization. The
archive packer has a different exclusion policy; hashing inspected entries does
not add excluded files back into an archive. Existing directory functions remain
synchronous and retain their previous behavior.

`CONTENT_HASH_LIMITS` caps the entry count at 1,024, raw and normalized content
at 64 MiB, each raw/normalized file at 16 MiB, paths at 100 UTF-8 bytes, and the root
manifest at 16 KiB with nesting depth 64. The deadline is five seconds. Callers may lower
these limits through `ContentHashOptions`; zero and values above the ceilings
are refused. Excluded entries still count toward raw limits and path-collision
checks. Paths must be canonical and distinct under NFC/case folding; shared
buffers and accessor-backed entry fields are refused. This validates ordinary
untrusted byte entries, not arbitrary JavaScript proxies or hostile host code.
`ContentHashInputError` reports fixed invalid-input, limit, abort or timeout codes
without including file contents or paths in its messages.

## Invitation email recovery

An existing account with no usable membership can explicitly recover access by
accepting an invitation with its secret and a fresh recovery code. This separate
flow creates no session, key, workspace, default pointer or credit grant. New
accounts use ordinary signup. A compatible service must enable email recovery.

Set `HASNA_SKILLS_API_URL` (or `SKILLS_API_URL`) explicitly for recovery. If both
are set, they must name the same API. Recovery never consults a keychain or saved
key to choose its server. It preserves all profiles and never treats cached
identity metadata as proof.

Generate and retain a challenge UUID **before** the first request. Keep it with
the same invitation ID and server, without storing the token or code. Run
`skills workspace invitations email-challenge <invitation-id>
--challenge-id <your-uuid> --confirm` to enter the invitation token through a
masked prompt, or add `--token-stdin` for exactly one secret input line.
The eligibility-neutral result does not confirm that a code was sent or delivered.
A reused challenge ID never requests a replacement code automatically.

After receiving the recovery code, run
`skills workspace invitations email-accept <invitation-id>
--challenge-id <same-uuid> --confirm`. Interactive entry masks the token and code;
`--secrets-stdin` reads the recovery code on line one and the invitation token on
line two. JSON use requires the corresponding stdin option. Never put proof in
arguments, environment variables, URLs, scripts or shell history.

Acceptance returns `accepted: true`, `changed: true`, `signInRequired: true` and
the organization/membership IDs. Use fresh ordinary sign-in afterward. If the
acceptance response is lost, sign in to inspect available memberships before any
further action; never retry acceptance automatically. If necessary, deliberately
request a new recovery challenge. An uncertain challenge response requires
retaining its original ID and checking your inbox, without automatic rotation.

Both SDK entrypoints expose `RemoteSkillsAuthClient` methods
`requestInvitationEmailChallenge({ invitationId, token, challengeId, confirm: true })`
and `acceptInvitationEmailChallenge({ invitationId, token, challengeId, code,
confirm: true })`. Both send one anonymous POST to the captured API origin and
return bounded, validated projections. `InvitationEmailInputError` rejects invalid
input, `RemoteInvitationEmailError` exposes fixed service refusal codes, and
`RemoteInvitationEmailUnconfirmedError` requires explicit reconciliation. No
cookie, Authorization header, credential resolution, login or profile write is
part of these methods.

For an agent host without a key, start
`skills-mcp --invitation-recovery --stdio` with an explicit API URL. This mode
exposes only `request_invitation_email_challenge` and
`accept_invitation_email_challenge`, with the same SDK input fields. It rejects
other startup flags, HTTP mode and local mode. The ordinary MCP startup and data
access gates remain in effect outside this mode. Treat host request history as
sensitive: tokens and codes appear only in the MCP input body and are never
returned or saved by the tools.

These clients still require deployed configuration and controlled real recipient
email acceptance before recovery can be offered as a live product capability.

### Injected operation transport

`@hasna/skills/sdk` exports `createSkillOperationClient` for an embedder-supplied
`SkillOperationTransport`. It provides a bounded JSON envelope, immutable
snapshots and explicit status lookup. It does not connect to a provider, discover
an endpoint, read credentials, or provide guest IPC or authorization.

```ts
import { createSkillOperationClient, type SkillOperationTransport } from "@hasna/skills/sdk";

function operationsForCapturedRun(transport: SkillOperationTransport) {
  return createSkillOperationClient(transport, { timeoutMs: 30_000 });
}
// The embedder supplies invoke(request, { signal }) and get(requestId, { signal }).
// invoke accepts { contractVersion: 1, requestId: UUID, operation: "text.generate",
//                  input: { prompt: "..." } }.
```

Create one client per captured authority scope. The transport must enforce that
scope, bind the request ID to the exact payload durably, and enforce approval,
budget and execution policy. The client remembers up to 256 request identities
and 1 MiB of canonical requests. It refuses capacity before transport and never
evicts an old identity. An explicit repeat with the same payload makes one new
transport call; a changed payload under a remembered ID is refused locally.
This local check does not replace server deduplication.

Requests are limited to 64 KiB and responses to 1 MiB of serialized UTF-8 JSON,
with depth and node limits exported in `SKILL_OPERATION_LIMITS`. Plain JSON data
is copied and deeply frozen; cycles, accessors, `toJSON` functions, unsupported
values and extra envelope fields are refused. Ordinary data inside `input` and
`output` is preserved. Request IDs use canonical lowercase UUID strings;
operation names use lowercase letters, digits and dot or hyphen separators.

Responses preserve `contractVersion` and `requestId`. A status of `succeeded`
includes `output`; `refused` includes a fixed `SkillOperationRefusal` code.
`pending`, `unknown` and authoritative `not-executed` have no additional fields.
Transport failure, in-flight abort and timeout produce a safe
`SkillOperationClientError` with an unknown outcome. They never prove that an
operation did not execute. The client does not retry or issue a status read
automatically: explicitly call `get` with the same request ID to reconcile.
Aborting locally does not establish server cancellation. An already-aborted
signal refuses before calling the transport.

### Authoring destination checks

Payload writers reject known native skill folders, physical aliases of the account's native roots, and configured home discovery roots (including OpenCode `skills.paths`) before creating directories. Malformed or unresolved native registrations fail closed and require the existing Skills discovery review. Changing the authoring data directory does not hide the account's native policy.

Other authoring tools can use the same read-only guard from the package root:

```ts
import { assertPortableAuthoringPath } from "@hasna/skills";

assertPortableAuthoringPath(destination, { homeDir: accountHome });
// Only now create or change the private authoring destination.
```

`homeDir` defaults to the current account home. Missing destination descendants are supported. The check reads configuration without loading plugins, fetching skills, or creating directories; it throws on refusal. It is a pre-write check, not a reservation against concurrent configuration or symlink changes. Call it again immediately before each later write. Native inventory and migration remain available for preserving existing copies.

Remote Codex plugins can report no installed release version. Fresh discovery can
review a cached skill only when its native installed/enabled plugin ID matches
Codex's local remote install receipt, its manifest and capability controls are
bound, and its exact path is already effectively disabled. This reviews a denied
materialization; it does not infer the installed version or enable cached skills.

### Reviewing Codex inference and local MCP settings

`codex-settings-v3` reviews tolerate model/effort/verbosity/service-tier changes,
and root/profile `personality` values `none`, `friendly`, or `pragmatic`,
and typed ordinary local stdio MCP configuration updates. The local MCP catalog
is separate from native skill discovery; MCP servers can still supply tool
context and instructions. This witness does not authenticate server responses.
Provider/auth/cloud routing, instruction files, context limits, native
skills/plugins/hooks, reserved Apps MCP servers and unknown fields stay bound.
HTTP, OAuth, remote-environment and unsupported MCP layouts retain their full
witness. V1/V2 reviews retain their original digest meaning.

The personality extension leaves existing V3 digests without that field unchanged.
A stored review that included personality requires a fresh explicit review before
its changed digest can be adopted. Unknown values and other personality fields
(including `features.personality`) remain refused or bound.

Capture a new review with `skills hook witness --kind codex-settings-v3 --path
/absolute/path/config.toml`. To migrate an existing raw, V1 or V2 review, preserve
and read back its exact reviewed configuration, then use `skills hook
rebind-settings --agent codex --codex-witness-version 3 --reviewed-preimage
/absolute/preserved/config.toml --expected-policy-sha256 <current-policy-hash>
--expected-settings-sha256 <current-config-hash>`; add `--apply` after reviewing
the plan. The legacy target remains V2 when the version option is omitted.
Migration compares the original witness before projecting the new contract,
refuses native discovery or unknown control changes, and changes policy only.
After explicit migration, ordinary supported local MCP updates require no
coordinated policy write.

### Reproduce a reviewed runtime dependency closure

For an exact-version copyfile update, supply an owner-private absolute npm
lockfile path and its reviewed SHA-256 together:

```sh
skills self-update --version <version> --reviewed-lock /absolute/package-lock.json \
  --reviewed-lock-sha256 <sha256> --min-release-age 7 --json
```

Use the same lock for a separately reviewed bootstrap. The lock must describe
the verified package archive as `file:./verified.tgz`, use lockfile format 3,
and bind its version, integrity and dependency declarations. Registry packages
must have exact versions and SHA-512 integrity at the configured npm registry.
The updater verifies each frozen version against current registry metadata
and the requested age policy, runs `npm ci` without re-resolving ranges, then
checks lock byte continuity and the actual required dependency closure with
`npm sbom --sbom-format=cyclonedx --package-lock-only=false`. This forces
installed-manifest inspection; ordinary `npm ls` can trust a hidden lockfile.
Existing publisher exemptions remain available through the repeatable
`--min-release-age-exclude` option. The receipt records the reviewed lock hash.

A reviewed lock does not authorize native skill loading, profile changes,
credential provisioning or session reconciliation. Without this optional input,
the existing update flow continues to resolve its dependency lock normally.

`codex-settings-v4` is an explicit successor to V3. It additionally ignores
only Codex's `tui.model_availability_nux` startup-tooltip count map when every
value is an integer in the native uint32 range. Ordinary native tables and
single-line inline maps are supported; unsupported layouts and malformed
values remain witnessed. Other TUI fields, numeric spelling and all discovery
controls stay bound. Existing byte/V1/V2/V3 reviews retain their original meaning.

Capture with `skills hook witness --kind codex-settings-v4 --path <config.toml>`.
Upgrade an existing review with `skills hook rebind-settings --agent codex
--codex-witness-version 4 --reviewed-preimage <preserved-config.toml>
--expected-policy-sha256 <policy-hash> --expected-settings-sha256 <settings-hash>`.
Review the plan before adding `--apply`; the original review preimage must match
its original mode, and unrelated changes refuse. This preserves the native
configuration, root aliases, other witnesses and active session pins.

`claude-settings-v4` is an explicit successor to `claude-settings-v3`. It
additionally ignores only a top-level `theme` whose value is exactly one of the
documented built-in values (`auto`, `dark`, `light`, `dark-daltonized`,
`light-daltonized`, `dark-ansi`, `light-ansi`). Custom and plugin themes, other
values or types, nested `theme` keys, `skipDangerousModePermissionPrompt` and
every permission, hook, environment, helper and unknown setting stay bound.
Existing raw/V1/V2/V3 reviews retain their original meaning.

Capture with `skills hook witness --kind claude-settings-v4 --path <settings.json>`.
Upgrade an existing review with `skills hook rebind-settings --agent claude
--claude-witness-version 4 --reviewed-preimage <preserved-settings.json>
--expected-policy-sha256 <policy-hash> --expected-settings-sha256 <settings-hash>`.
Review the plan before adding `--apply`. See
[built-in theme reviews](docs/plugin-admission.md#explicit-v4-built-in-theme-reviews).

`claude-marketplace-entry-v1` witnesses one plugin entry of a Claude
`marketplace.json` instead of the whole catalog, so Claude's own marketplace
refreshes do not invalidate a review of a plugin declared only by its entry.
It binds the marketplace name, `metadata.pluginRoot`,
`allowCrossMarketplaceDependenciesOn` (its value, or its absence, for every
entry) and the entry's identity, source and every component or command-bearing
field; display metadata such as `description` and `version` is omitted. Its
canonical JSON sorts object keys and is hashed under the domain prefix
`hasna.skills.claude-marketplace-entry.v1\0`; this deliberately differs from
`claude-plugin-manifest-v1`, which keeps key order. Unknown keys, a missing,
duplicated or renamed entry, and unparsable JSON refuse. Capture with `skills
hook witness --kind claude-marketplace-entry-v1 --path
<.claude-plugin/marketplace.json> --marketplace <name> --plugin <name>`.

An unknown top-level, `metadata` or entry key refuses with the mode, the bound
marketplace name and the exact key path, never the value, for example
`claude-marketplace-entry-v1: unknown top-level key "x" in
claude-plugins-official` or `unknown key "plugins[swift-lsp].x"`. The only way
forward after such a refusal is a fresh human review of the changed catalog and
a guarded exact re-pin: write the reviewed witnesses to a discovery inputs file,
preview `skills hook install --agent claude --discovery-inputs <file>`, then
run the same command with `--apply`. While the key is present this mode refuses
capture as well, so the re-pinned review must bind the catalog another way, such
as an exact `bytes` witness, until a reviewed version of this mode covers the
key. There is no bypass, ignore list or relaxed mode. See
[marketplace plugin entry witness](docs/plugin-admission.md#marketplace-plugin-entry-witness).
