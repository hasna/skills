# Reviewed plugin admission

`skills integration plugin` prepares a plugin before a coding agent discovers
it. Projection contracts support schema versions 1 and 2; targets use schema
version 1, bindings use schema version 2, and admission plans and receipts use
schema version 3. Claude command sources use `copy` mode, certified against
Claude 2.1.274 and 2.1.276 on Linux ARM64. It removes native skill and command prompts while preserving
reviewed agents, tools, MCP, LSP, hooks and assets. Prompt hooks enforce drift;
they do not clean an already loaded plugin catalog.

All packages and migration mappings belong in the owner's private Skills
instance. The public Skills package ships this software and synthetic tests;
it contains no operational plugin catalog or skill payloads. The Skills server
can use its supported storage backend. Plugin admission does not require S3.

## Private package contract

Publish migrated prompts through the normal versioned Skills authoring flow.
Then publish a separate instruction bundle containing `plugin-projection.json`
and the original regular-file plugin tree under `original/`. Keep its root
instruction and package metadata outside that tree. Select the integration
bundle and all its mapped payload versions in a dedicated integration profile.
These operations do not silently publish or change a selection profile.

The exported `PluginProjectionManifest` retains this strict version 1 contract:

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `agent` | `1`, `"claude"` |
| `pluginId` | Exact `plugin-name@marketplace-name` |
| `upstream` | Credential-free HTTPS source, revision, version, license, and original `treeDigest` |
| `review.hooks` | `"reviewed-no-skill-injection"` |
| `review.dependencies` | `"reviewed-no-retired-payload-dependency"` |
| `payloads` | Every original skill and command prompt, with source path, kind, source digest and exact hosted target slug/version/bundle digest |

Schema version 2 also supports original manifests that omit `version`. It uses
`upstream.version: null`, requires a full lowercase 40- or 64-character Git
commit in `upstream.revision`, and still binds the complete original tree digest.
A null version refuses an original manifest with any `version` field, including
null or an empty string. A declared version must still match exactly. No vendor
version is invented or written into the projection. Claude's command-copy cache
uses a bare 12-character content hash when the manifest has no version; declared
versions retain their version-plus-hash form. Both forms require the exact
admitted producer receipt and complete file witnesses.

Version 2 requires `review.documentation`, an array containing zero or one
`{ path, sourceDigest }` entries. Only an exact root `README.md` (case-insensitive
spelling), with mode 0644 and its one-file tree digest, can be declared inert
documentation. Its original bytes may describe a retired prompt. The exception
refuses a README selected by a native component, referenced by native configuration,
or referenced by another retained text file. Other Markdown, including agents,
keeps the strict removed-file and native skill-preload checks. An undeclared README
also keeps those checks. This explicit review does not certify arbitrary dynamic
runtime behavior: dependency review must still establish that the README is not
an indirect runtime input. Version 1 gains no documentation exception.

`pluginTreeDigest(entries)` hashes sorted file witnesses: path, normalized mode,
size and SHA-256. A payload's `sourceDigest` is that function applied to its
single original file. The source is preserved byte-for-byte in the private
archive; the native projection is derived from it. Default and custom command
paths, dormant default commands, root skills and case-insensitive aliases are
covered. Custom skill trees are removed, including their support files. The
only rewritten ordinary file is the plugin manifest when its `skills` or
`commands` declarations need removal.

Overlapping ordinary components, runtime references to removed files, native agent
skill preloads, unsupported manifest fields and upstream package installation
requirements refuse admission. Review must cover indirect/dynamic dependencies
as well as the direct references checked by software. Admission never executes
an upstream shell command or installation script. Preserved plugin tools and
hooks still run under the native agent's normal trust controls when used.

## Plan, admit and resolve

Prepare an owner-only JSON `PluginAdmissionTarget` with schema version 1,
plugin ID, exact `registrations` (user and/or canonical project paths), certified
native executable/version/digest, and the absolute Skills executable/digest.
One marketplace command serves that complete reviewed registration set.
Executable digests use `sha256:<hex>`; symlink aliases must be resolved to their
reviewed canonical file paths. No executable is invoked while planning.

```sh
skills integration plugin plan plugin-container --selection-profile integrations --target /absolute/private/target.json
skills integration plugin admit plugin-container --selection-profile integrations --target /absolute/private/target.json --plan-digest sha256:REVIEWED_DIGEST --evidence-digest sha256:REVIEWED_EVIDENCE
skills integration plugin resolve --binding REVIEWED_BINDING_ID
```

Plan and admit emit JSON. Review the exact plan digest, retained/removed file
witnesses, provenance and hosted payload mappings. Admit refetches the profile
and exact bundles before accepting that digest. Its owner-only immutable receipt
binds authority, workspace, profile ID, exact canonical container and mapped
payload versions/digests, source and projection digests, scope set, executable
witnesses, resolver command, authenticated owner identity, exact profile
revision, aliases and triggers. `observation` records the same freshly observed
principal and routing state. `evidenceDigest` hashes that complete authenticated
evidence snapshot, and `planDigest` hashes the admission identity including the
evidence digest. Admission requires both reviewed digests. Receipt reads validate
both hashes, strict field schemas and agreement between mapped and observed
identities. Legacy binding, plan and receipt schemas are refused rather than
upgraded implicitly. Originals remain in the
private hosted bundle; local native materializations contain only the projection.

The owner-local store is `~/.hasna/skills/plugin-admission/`: `bindings/` holds
content-addressed bindings, `receipts/<binding>/` holds approved plans, and
`objects/<binding>/<plan-digest>/` holds complete immutable projections. The
resolver freshly authenticates through normal owner credential configuration
on every call, including exact payload bundle reads. It refuses environment
authority/local-storage overrides. No `--cached`, API URL/key or local fallback
option exists. The resolver calls authenticated `whoami` before and after profile,
bundle and executable verification. The stable user/account identity and required
`owner` role must remain unchanged, and the account must equal the selected
workspace. Credential rotation remains valid because receipts never bind a raw
API-key identifier. Any profile revision, alias or trigger change requires a new
plan and explicit approval, including edits made after review. Missing
canonical selections, changed versions/digests, authority/workspace/profile
changes, revoked API access, changed package content or executable witnesses
still refuse or require renewed admission. A mapped canonical slug cannot be
replaced through an alias, even with identical content. Human plan/admit input
may use an integration alias; the resulting binding uses its canonical slug.

Re-admitting an unchanged identity and evidence returns its original receipt.
A new plan reports current principal and routing evidence. Resolver calls remain
write-free. Canonical object keys and
registration-set ordering keep binding IDs, plan digests and persisted binding
bytes stable.

Configure the private marketplace source using the receipt's exact
`sourceCommand`, `source: "command"`, `mode: "copy"` and `timeout: 30`.
On certified Linux hosts, that accepted command opens the reviewed resolver,
hashes `/proc/self/fd/9` with the absolute system SHA-256 utility, and executes
the same pinned descriptor. A pathname replacement before the open is rejected;
a replacement after hashing cannot become the executed resolver. The resolver
has a 25-second API deadline and prints exactly one absolute
directory path on success. Errors produce sanitized stderr and a nonzero exit.
Only explicit admission writes artifacts; resolve cannot publish or materialize
an unapproved revision. Concurrent admission uses a nonwaiting publication lock.
Interrupted attempts cannot expose partial directories as successful results.

Registration and activation remain explicit operations. Review the command
shown by Claude's JSON install/update response and pass its exact
`--accept-command` hash; never substitute blanket approval. Command-source
support begins at 2.1.229 and exact CLI acceptance at 2.1.271, but version 1
certifies 2.1.274 and 2.1.276. Claude invokes the source during installation and updates;
this does not imply a resolver invocation on every agent startup. This command does not upgrade Claude, register a
marketplace, change native settings, disable other plugins or restart agents.

## Discovery transition contract

After explicit native registration, use `captureManagedPluginRegistry()` in a
reviewed discovery input. It emits a `claude-plugin-registry` source witness with
the registry path and exact admission bindings. Keep the normal full witnesses
for native settings, marketplace catalog/source configuration and other loader
inputs. Do not retain a competing whole-registry byte witness when intentionally
admitting receipt-backed transitions; unmanaged entries remain covered by the
structured registry witness itself.

Only these managed row fields can vary after validation: `version`,
`installPath`, `sourceProducerPath`, `previousProducerPaths`, `lastUpdated`.
Every current row must match its own producer receipt and exact reviewed scope.
All retained native cache versions must match approved immutable projections,
including their command files, ordinary components, paths, modes and membership.
The certified native adapter separately validates root `.in_use/<pid>` process
markers and `.orphaned_at` epoch-millisecond pruning markers. These bounded
metadata records cannot authorize content, and cannot come from the original
package. Links, unknown keys, payload files and nested directories still refuse.
Every unmanaged row and every unknown field remains in the witness. New
registrations, changed commands, cross-scope substitutions or modified caches
refuse. Old receipts and projections remain until separately reviewed retirement.

Project plugin enablement requires a full reviewed settings-file witness and
matching admitted project registration. Other project discovery overrides and
new loaders still require their dedicated review. API failure refuses an update; it does not report a
stale projection as synchronized. Claude may retain its previous installation
after a refused update, whose existing local drift checks continue to apply.

## Marketplace registry timestamps

For an explicitly reviewed `known_marketplaces.json`,
`captureClaudeMarketplaceRegistry(path)` emits a separate
`claude-marketplace-registry` witness. It preserves every marketplace name,
source, install location and unknown value. Only a valid UTC `lastUpdated`
timestamp can vary, and only for exact rows containing `source`,
`installLocation` and `lastUpdated`, with a recognized GitHub repository or local
directory source. Rows with any extra field, including `autoUpdate`, retain
their entire contents in the digest. Registration changes still refuse.

This mode is opt-in for reviewed Claude discovery. It cannot project fields,
carry managed-plugin rules, accept an absent registry or synthesize registry
changes during hook installation. It does not replace the separate settings,
installed-plugin, marketplace catalog, loader, root or payload witnesses.
Capture requires a bounded regular file with strict UTF-8 and unambiguous JSON;
links, duplicate keys and concurrent file replacement refuse.

Existing byte witnesses retain their exact behavior. A prior hash mismatch is
not proof of a timestamp-only change: review the complete current registration
and its complementary sources before explicitly replacing an old witness.
Capturing this witness does not write a policy or approve native registration.

## Marketplace plugin entry witness

`claude-marketplace-entry-v1` witnesses one plugin entry of a Claude
`marketplace.json`, for a plugin whose only declaration is its marketplace entry
(for example a `strict: false` entry with no `plugin.json`, such as
`swift-lsp@claude-plugins-official`). A bytes witness of the whole catalog
drifts every time Claude refreshes the marketplace by itself; this mode moves
only when something that decides how the selected entry resolves or what it
injects changes.

The source names an absolute, normalized `<root>/.claude-plugin/marketplace.json`
path, the exact marketplace `name` and the exact plugin entry `name`:

```json
{ "path": "/home/user/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json",
  "hashMode": "claude-marketplace-entry-v1", "marketplace": "claude-plugins-official",
  "plugin": "swift-lsp", "sha256": "<digest>" }
```

It is accepted only in explicit reviewed Claude discovery. Paths with `..`,
`//`, a trailing slash, control characters, another file name or another parent
directory refuse, as do names outside `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`.

The digest is SHA-256 over the domain prefix
`hasna.skills.claude-marketplace-entry.v1\0` and canonical JSON (sorted object
keys, array order and number spelling kept, no whitespace) of:

- the marketplace `name` and `metadata.pluginRoot` (`null` when absent), and
  `allowCrossMarketplaceDependenciesOn` (`null` when absent) only when the entry
  declares `dependencies`;
- the selected entry projected to its bound keys: `name`, `source`, `strict`,
  `defaultEnabled`, `dependencies`, `relevance`, `headers`, `headersHelper`,
  `settings`, `userConfig`, `types`, `channels`, `skills`, `commands`, `agents`,
  `hooks`, `mcpServers`, `lspServers`, `outputStyles`, `workflows`,
  `experimental`, `themes` and `monitors`, each with its full value.

The entry's display and catalog metadata is validated and omitted:
`$schema`, `description`, `version`, `author`, `homepage`, `repository`,
`license`, `keywords`, `category`, `tags`, `displayName` and `metadata`. A real
version or install-path change is still caught by the separate
`installed_plugins.json` witness, which this mode never replaces. Other entries,
the catalog `description`, `version`, `owner` and `$schema`,
`forceRemoveDeletedPlugins` and renames of other plugins do not move the digest.

The mode fails closed. Capture and verification refuse when:

- the file is missing, a link, a special file, larger than 1 MiB, not strict
  UTF-8, not one JSON object, has trailing content or a duplicate key;
- the marketplace `name` differs from the bound name, or `plugins` is not an
  array;
- the selected entry is missing, appears twice, or has a case-only variant;
- `renames` maps the selected name to another entry or to `null`;
- the entry has a key outside the two lists above (including the directory
  listing fields), `experimental` has a key other than `themes`, `monitors` or
  `evals`, or an object `source` has an unknown type or a field outside that
  type's documented fields (a `url` source may also carry `path`, as the
  official catalog does);
- the catalog has a top-level key outside `$schema`, `name`, `owner`,
  `plugins`, `description`, `version`, `metadata`, `forceRemoveDeletedPlugins`,
  `allowCrossMarketplaceDependenciesOn` and `renames`, or a `metadata` key other
  than `description`, `version` and `pluginRoot`;
- an omitted metadata field has the wrong type.

New fields are refused, never ignored, until a reviewed version of this mode
covers them. The field lists follow the
[marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference)
and the [plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference),
read on 2026-10-07.

Capture a witness with
`skills hook witness --kind claude-marketplace-entry-v1 --path <marketplace.json>
--marketplace <name> --plugin <name> --json` (or
`captureClaudeMarketplaceEntry(path, marketplace, plugin)`). Capture writes
nothing and does not authorize a review. Put the witness in reviewed discovery
inputs, keep the `settings.json`, `installed_plugins.json` and
`known_marketplaces.json` witnesses and the plugin's absence witnesses, and
preview `skills hook install --discovery-inputs <file>` before applying. Hook
installation never rewrites the catalog, so an entry change between planning
and applying refuses.

Install a runtime that recognizes `claude-marketplace-entry-v1`, including any
bundled copy of the verifier, before a policy carries it; an older runtime
refuses the whole policy because the hash mode is unknown.

## Claude settings preferences

`captureClaudeSettings(canonicalSettingsPath)` returns a versioned
`claude-settings-v1` discovery source for the configured Claude user
`settings.json`. Use the canonical target when a reviewed home root alias is
present. The mode is accepted only in explicit reviewed Claude discovery; it
cannot stand in for a plugin manifest, executable, project settings review or
another agent's configuration.

The digest canonicalizes JSON object key order, preserves array order and
unknown numeric values without rounding, and excludes only these top-level
preferences and model selections with valid documented types:

- Booleans: `autoScrollEnabled`, `axScreenReader`, `emojiCompletionEnabled`,
  `prefersReducedMotion`, `showTurnDuration`, `spinnerTipsEnabled`,
  `syntaxHighlightingDisabled`, `terminalProgressBarEnabled`,
  `terminalTitleFromRename`, `verbose`, `wheelScrollAccelerationEnabled`.
- Exact strings: `editorMode` (`normal`, `vim`), `tui` (`default`, `fullscreen`),
  `viewMode` (`default`, `verbose`, `focus`).
- Built-in `model` values: `default`, `best`, `fable`, `fable[1m]`, `sonnet`,
  `sonnet[1m]`, `opus`, `opus[1m]`, `haiku`, `opusplan`; exact model IDs
  `claude-fable-5-1`, `claude-fable-5`, `claude-fable-5[1m]`, `claude-opus-5`,
  `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-6`,
  `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929`, `claude-opus-4-8`,
  `claude-opus-4-8[1m]`, `claude-opus-4-7`, `claude-sonnet-4-6`,
  `claude-opus-4-5-20251101`, `claude-opus-4-5`, `claude-haiku-4-5`,
  `claude-fable-5-1[1m]`, `claude-opus-5[1m]`, `claude-opus-4-7[1m]`,
  `claude-opus-4-6[1m]`, `claude-sonnet-4-6[1m]`.

The model exception follows the documented [model picker](https://code.claude.com/docs/en/model-config#setting-your-model)
and [model IDs](https://platform.claude.com/docs/en/models/overview), including
the documented [extended-context model-name suffix](https://code.claude.com/docs/en/model-config#extended-context)
only for the listed supported combinations. It permits
inference selection among this fixed list, including clearing the override. It
does not exempt provider or alias mappings, `modelOverrides`, `modelPicker`,
`modelSettings`, `availableModels`, environment or model-switch hooks. Arbitrary
custom, provider-specific, future or path-like model strings stay bound; there
is no prefix wildcard or dynamic model lookup. Non-string model values refuse.

Invalid values for the display preferences refuse capture and verification. Every
other field remains bound, including unknown future fields, hooks and their
exact commands, permissions, native skill suppression and synchronization,
plugin roots, marketplaces, environment and configuration precedence. Language,
output style, theme (v4 alone permits the built-in theme values), and
command-bearing status or file suggestion settings are intentionally retained. These are narrow preference and inference-selection
exceptions, not general permission to change Claude configuration. The native
bridge guard continues to check its exact commands and native Skill policy.

Migration requires reviewing the current complete settings and complementary
plugin/loader sources, replacing the settings raw source with the captured
typed source in a reviewed discovery-input file, and using the normal hook
installation plan/apply operation. A stale prior raw hash is not evidence that
only preferences changed. Capture performs no write or automatic refresh; old
raw witnesses remain exact. Concurrent changes during an installation still
face full-byte preconditions so a preference edit cannot be overwritten.

The source must be a stable normalized regular file named `settings.json` with
strict UTF-8, no duplicate JSON keys and no trailing content. Limits are 1 MiB,
1,024 top-level fields, depth 32, 65,536 nodes and 16,384 characters per string;
capture also consumes the shared discovery byte budget. Symlinks, special
nodes and changes during a read refuse. This witness covers the configured
user file; existing checks on project settings, root aliases and plugin sources
remain separate. It does not certify arbitrary command-line settings overrides
or guarantee when a running native client adopts a settings edit.
Those complementary checks retain their existing exact registration and hook
entry comparisons; this mode does not relax them for property-order changes.

### Explicit v4 built-in theme reviews

`claude-settings-v4` is an explicit successor to v3. It binds everything v3
binds, with one more omission: the top-level `theme` key, and only when its
value is exactly one of the built-in values `auto`, `dark`, `light`,
`dark-daltonized`, `light-daltonized`, `dark-ansi` or `light-ansi`. The list is
pinned in code (`CLAUDE_BUILTIN_THEMES`) from the
[`theme` setting reference](https://code.claude.com/docs/en/settings-reference#theme)
and the [built-in presets](https://code.claude.com/docs/en/terminal-config#match-the-color-theme),
read on 2026-10-07. Custom and plugin themes (`custom:<slug>`,
`custom:<plugin-name>:<slug>`) load theme files, so they stay bound, as does any
other value, type, spelling or letter case, and any `theme` key nested inside
another setting. `skipDangerousModePermissionPrompt`, permissions, hooks,
environment, `apiKeyHelper` and other helpers, plugins, marketplaces, custom
model values and unknown settings stay bound exactly as in v3. The digest is
domain-separated from v3.

Existing v1, v2 and v3 witnesses keep their meaning; nothing selects v4
implicitly, and a stored witness is never rewritten. A policy opts in through
either explicit path:

- a fresh review: `skills hook witness --kind claude-settings-v4 --path
  <settings.json> --json` (or `captureClaudeSettingsV4(path)`), placed in the
  reviewed discovery inputs and applied with the normal `skills hook install
  --discovery-inputs <file>` plan/apply flow;
- a preserved-preimage upgrade: `skills hook rebind-settings --agent claude
  --claude-witness-version 4 --reviewed-preimage <preserved-settings.json>
  --expected-policy-sha256 <policy-hash> --expected-settings-sha256
  <settings-hash>` (or `upgradeClaudeSettingsWitnessV4`). It accepts a raw, v1,
  v2 or v3 witness, proves the preimage matches it in its original mode, and
  refuses unless the current settings equal the preimage under v4. Without
  `--claude-witness-version` the rebind target remains v3.

Install a runtime that recognizes `claude-settings-v4`, including any bundled
copy of the verifier, before a policy carries it; an older runtime refuses the
unknown hash mode.

## Verification and limits

Unit tests cover provenance and mapping failures, offline/revoked authorities,
timeouts, concurrent publication, symlinks/special files, cache mutation, retained
history, and exact unmanaged registry coverage. Synthetic native tests exercise
actual Claude with a disposable home and loopback mock authority in a separate
network namespace. They contact no real provider and require explicit opt-in:
`SKILLS_TEST_CLAUDE_BIN`, `SKILLS_TEST_CLAUDE_SHA256` (reviewed native executable
digest), `SKILLS_TEST_CLAUDE_VERSION` (defaults to 2.1.274), and
`SKILLS_TEST_NETWORK_ISOLATED=1`. Both versioned and versionless upstream
manifests run through install, unchanged and changed updates, refusal and drift checks. Before native execution, the test
checks the source before/after copying, complete copied digest, size and ELF
format, then atomically publishes its private executable fixture.

The initial implementation is a reviewed admission boundary, not an upstream
ingestion scheduler or a general plugin execution sandbox. MacOS runtime proof,
additional native versions and providers require their own canary evidence.
Package data is bounded to 1,024 files, 64 MiB total and 16 MiB per file. Native
cache history is bounded to 128 entries and an aggregate 256 MiB per witness.

Primary runtime references: [command sources](https://code.claude.com/docs/en/plugin-marketplaces#command-sources),
[plugin components](https://code.claude.com/docs/en/plugins-reference), and
[exact command acceptance](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21271).

### Explicit v2 preference reviews

For new reviews, use `captureClaudeSettingsV3(path)` or
`skills hook witness --kind claude-settings-v3 --path <settings.json> --json`.
The v3 witness recognizes an entry containing only a valid `effortLevel`
independently of its model name. Claude can persist a preference for a newly
released model without blocking the next prompt. Entries with additional
properties, including `maxEffortLevel`, remain fully bound, as do provider
mappings, hooks, permissions, plugins, environment and unknown settings.
The top-level model selection rules remain unchanged.

Legacy v1 and v2 digests retain their meaning. `upgradeClaudeSettingsWitness`
accepts a legacy witness and a saved `settings.json` preimage. It verifies that
the preimage matches the old digest and that current settings differ only in
recognized preferences before returning a v3 witness. It refuses all other
drift. Use that witness in reviewed discovery inputs and apply the normal
guarded integration plan. Install compatible runtimes before activating v3;
when updating agents, verify their actual hook commands and native trust, not
only the executable found on `PATH`.

`captureClaudeSettingsV2(path)` creates a `claude-settings-v2` witness. In
addition to the v1 display/model selections, it tolerates the documented
persisted effort values `low`, `medium`, `high`, and `xhigh`, both at the top
level and in known built-in model entries whose only property is `effortLevel`.
Custom model entries and entries with any other property remain fully bound.
The boolean `skipDangerousModePermissionPrompt` remains bound: Claude also uses
this saved acceptance in bypass-mode and pending project MCP approval decisions.
Permission settings, plugins, hooks, environment, ultracode and unknown
configuration remain bound. Version 0.9.14 corrects the 0.9.13 normalization of
this flag; an existing v2 review containing it must be explicitly reviewed again.
Invalid recognized preference types are refused.

`captureClaudeMarketplaceRegistryV2(path)` creates a
`claude-marketplace-registry-v2` witness. It also recognizes a registry row with
an optional boolean `autoUpdate`. That boolean remains bound; only a strictly
validated `lastUpdated` timestamp may vary. A new source or installation path,
a changed automatic-update policy, or an unknown field still requires review.

Capture either witness through the CLI:

```sh
skills hook witness --kind claude-settings-v2 --path /canonical/home/.claude/settings.json --json
skills hook witness --kind claude-marketplace-registry-v2 --path /canonical/home/.claude/plugins/known_marketplaces.json --json
```

Capture does not install or authorize a review. Compare the current complete
configuration with its previous review, put the chosen witness in the reviewed
discovery inputs, and preview `skills hook install --discovery-inputs <file>`
before applying. Existing byte and v1 witnesses are never silently converted.
Runtime support for the selected witness version must be installed before
policy activation. A real hook installation is a configuration change, not a
preference: its owning installer must coordinate a guarded settings/policy
update, or it needs a fresh explicit review.

The effort schema follows [Claude's model configuration documentation](https://code.claude.com/docs/en/model-config#adjust-effort-level).

Cooperating installers can use `planClaudeHookEventsUpdate` with an explicit
selection of supported Claude hook events. `planClaudePreToolUseHookUpdate` and
`planClaudeStopHookUpdate` are single-event convenience wrappers. Supported events
are `PreToolUse`, `PostToolUse`, `Stop`, `Notification`, `SessionStart`, `SessionEnd`
`UserPromptSubmit` and `SubagentStart`. The transaction requires the exact settings SHA-256
preimage and preserves every field outside the selected events, including other
hooks. Apply the returned plan through `applyAgentIntegration`; this validates
existing managed discovery and native guards, writes settings and policy with
precondition checks, and retains recovery backups. An invalid policy or existing
drift is a refusal, never permission to use an uncoordinated writer. A null plan
means no managed Skills policy exists. These APIs do not authorize the hook's
behavior or turn a configuration-changing hook into a preference.

The transaction verifies every agent's discovery sources, directories and
automatic discovery closure. Native runtime and trust checks cover Claude and
the declared consumers of the settings path, including containing roots or
directories and OpenCode's Claude compatibility surface. Unrelated agents keep
their exact witnesses and trust state; they must still pass their own consumer
checks before use. The plan's `managedAgentChecks.agents` and `nativeSkills`
describe this scoped runtime check, not a fleet health result. A path-identity
witness intersecting the write still refuses instead of adopting a new inode.

## Codex bundled cleanup controls

Qualified native skill review supports a narrow subset of Codex 0.159.2,
0.160.0 and 0.160.1's bundled cleanup hooks. The identities `browser`, `chrome`, `chrome-dev`,
`chrome-internal` and `computer-use` in `openai-bundled` may call
`node_repl.turn_ended`; `unified-computer-use` may call `cua_repl.turn_ended`.
Only `Interrupt`, `SubagentStop` and `Stop` are accepted, with one group and one
MCP handler per event. Inputs are the exact native event, turn and session
placeholders; `SubagentStop` uses the child `agent_id` for its session value.
Commands, matchers, other arguments, external hook files and a plugin MCP
declaration alongside these hooks remain refused. Apps cleanup routing requires
connector identity from a native tool catalog and is not admitted by this path.

The complete inline hooks stay in the manifest fingerprint across cache versions,
including after all native skill bodies disappear. A changed hook fails guarded
apply and subsequent discovery checks. This review preserves native cleanup;
it neither enables plugins nor grants hook trust, browser authority or signing.
The upstream contracts are
[0.159.2 bundled hooks](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/codex-rs/plugin/src/bundled_hooks.rs)
and [0.160.0 bundled hooks](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/plugin/src/bundled_hooks.rs);
0.160.1 carries the identical file
([0.160.1 bundled hooks](https://github.com/openai/codex/blob/d27764b82f7118f674371e6d6e76271d9d606edb/codex-rs/plugin/src/bundled_hooks.rs)).
