# Changelog

## Unreleased

- Add `skills metadata preview <slug> --category <c> --tags <json> --save <plan>` and `skills metadata apply --file <plan>` to correct a published skill's category and tags without publishing a bundle. Preview only reads and saves a private plan that preserves the original instruction body. Apply sends only category and tags, and requires the same authority and organization, publish permission, the exact current metadata revision and a matching server ETag. Body, kind, version and bundle identity must stay unchanged, and conflicts refuse. An uncertain PATCH is read back once and never resubmitted; an unconfirmed readback reports `METADATA_UPDATE_UNCONFIRMED`. The SDK exposes `RemoteSkillsClient.prepareSkillMetadataUpdate`, `applySkillMetadataUpdate` and the body-free `metadataPlanSummary`. Validation now resolves a portable skill's `kind` from `skill.json` before the directory checks run, so instruction skills no longer report executable-only package and source findings. A `skill.json` that declares an executable skill is now checked against the executable rules, even when the SKILL.md frontmatter says `kind: instruction`.
- Add `skills hook codex-reconcile [--apply] [--json]`, a package-owned reconcile for Codex plugin skill names. A Codex or plugin update that only adds or renames skill names, or bumps a manifest `version`, no longer leaves `NATIVE_SKILL_DRIFT` blocking every Codex session, and guards no longer need to be turned off. The command reads Codex's qualified skill and installed-plugin catalog and collects the plugin-cache copies the full strict guard refuses. It adds each new name of an enrolled plugin with an unchanged capability tuple to the reviewed controls, and denies it by its stable qualified name in `config.toml`. It also enrolls a not-yet-enrolled skills-only plugin. When that plugin is remote, its install receipt is bound only if the native catalog confirms it. Runtime-cache skills are denied by qualified name; one without a qualified name gets a reported exact-path deny. Every installed plugin explicitly enabled in `[plugins]` is classified, including plugins the binding does not know; an enabled id that does not parse refuses. Classification scans every version root, without regard to case and at any depth, against the shared location sets in `codex-plugin-capability-paths.ts`. That covers the root `plugin.json` Codex reads first, `.codex-plugin`, `.claude-plugin`, `.cursor-plugin`, `hooks/`, `hooks.json`, `.mcp.json`, `.app.json`, `commands/`, `agents/`, nested declarations, misspelled skill documents and links. New manifests are checked against the shared metadata-key allowlist, so inline manifest hooks count. Every skills-only result cites the manifest paths it read. Enrolled plugins get the same strict scan as well as the reviewed-tuple check. Their stale full-byte witnesses are re-captured only when both checks pass. The writes go through the existing `hook install` planner and transaction (kernel lock, preimages, backups with readback, receipt, compensation), are re-planned under the lock, and complete only when the strict guard accepts the result. Any change that touches more than skill names refuses with the new `CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED`, writes nothing, and lists each plugin with its capability kinds: an app, MCP, hooks, manifest or remote-receipt change of an enrolled plugin, or a not-yet-enrolled plugin carrying an app, MCP or hooks, including an enabled plugin the binding does not know. The guard's capability refusal now reads `NATIVE_SKILL_DRIFT: CODEX_PLUGIN_CAPABILITY_REVIEW_REQUIRED: ...`. Bindings that never recorded an installed-plugin catalog review refuse with `CODEX_RECONCILE_DISCOVERY_REVIEW_REQUIRED`. An enable rule for a name or document the run would enroll or deny, including runtime-cache skills denied by name, also refuses, as do unmeasured Codex releases. The allowed set comes from Codex's own report: any skill the catalog reports enabled that no row appended by this run disables, including one Codex still reports enabled despite an existing deny, refuses with `CODEX_NATIVE_SKILL_ALLOWED_SET_INVALID`. Every run prints one JSON line: `outcome` is `applied`, `unchanged`, `planned`, `refused` or `error`, with `code` exactly on refusal or error. Exit status is 0, 2 for refused and 1 for error. A second apply returns `unchanged`.

## 0.10.80

### Patch Changes

- Fix `skills setup agents` for Claude Code 2.1.302 (PLA8-00523). A successful native `claude mcp add` on 2.1.302 initializes first-start metadata in `~/.claude.json` (`firstStartTime`, `firstStartVersion`, `machineID`, migration flags, an empty `seenNotifications`, `migrationVersion`), and Skills rejected that as an unexpected change. Only those new keys, with exact value shapes, are now accepted; every pre-existing field must still be unchanged, and any other new key still refuses. The consumer gate now runs the real Claude 2.1.302 registration, direct and through `skills setup agents`.

## 0.10.79

### Patch Changes

- Admit the user-scoped Claude directory marketplace writer on the exact 2.1.301 and 2.1.302 versions. In synthetic homes, their `plugin marketplace add` and `plugin install` writes to `settings.json`, `known_marketplaces.json`, `installed_plugins.json` and the plugin cache match 2.1.300 byte for byte, after normalizing the home path and generated timestamps. Unmeasured versions such as 2.1.303, suffixed 2.1.301 and 2.1.302 builds, and project scope still refuse.

## 0.10.78

### Patch Changes

- Preserve the selected credential profile and transient API origin when registering Skills with coding agents, including post-login setup. Registrations explicitly start stdio, retain unrelated MCP configuration, and keep credentials in the existing resolver rather than agent config. Claude re-registration updates its active user config with verified preservation and refuses competing writes.

- Add `skills publication create <slug>` for private or team skills with Pro access, explicit confirmation and fresh interactive verification bound to the captured profile and server. Remote list/info preserve validated skill IDs and accept uncategorized skills. After an uncertain create, recover the ID with `skills --profile <profile> info <slug> --remote --json` before publishing.

- Admit the exact Codex 0.163.0 hooks, qualified skill catalog and installed-plugin review contracts, so `skills hook native-catalog`, `skills hook trust` and installed-plugin review stop refusing it with `CODEX_HOOK_TRUST_NATIVE_UNSUPPORTED_VERSION`. The npm `@openai/codex@0.163.0` linux-arm64 binary (sha256 `8a96f66d059d653e68bfd5f3c79337e6f1d7d170d80bf705eb7d0249b34c0ece`, built from `rust-v0.163.0` 83086188) generates byte-identical app-server schemas to 0.162.1 for every method and notification Skills uses (`initialize`, `configWarning`, `hooks/list`, `config/read`, `config/batchWrite`, `experimentalFeature/list`, `skills/list`, `plugin/installed`, `plugin/install`), the app-server source that serves `skills/list` and `hooks/list` is unchanged, and native probes of hook discovery, trust hashes, the version-guarded trust write, the default-config fallback warning, local plugin installation and plugin enablement return the same results as 0.162.1. One behaviour is new: a `[plugins._default]` table can now disable an installed plugin whose own entry omits `enabled`. Reviewed plugin inactivity still requires an explicit `enabled = false`, which 0.163.0 honours whatever the default, and the `plugins` table stays fully bound in the discovery witnesses, so a plugin disabled only by the default is refused rather than treated as reviewed. Neighbouring releases such as 0.163.1, 0.164.0 and 0.163.0 prereleases still refuse, and native corpus admission is still required separately.

## 0.10.77

### Patch Changes

- Preserve internal gateway credentials during customer sign-in. Refuse replacing a fleet credential before starting authentication, keep the selected profile and API origin stable while waiting for approval, and give profile-specific recovery commands in the CLI and TUI.

- Make the semantic Codex cache witness (`skills hook rebind-cache`, `bridge.discovery.codex.codexSemanticCache`) refuse every plugin capability location Codex reads that it does not bind. The witness bound the Codex manifest without its version, `.app.json`, `.mcp.json`, the reviewed hook plugin's `hooks/hooks.json`, remote install receipts, plugin folder membership and qualified skill names, and treated everything else in a version root as an inert asset. A plugin version could therefore gain an Agent Plugins root `plugin.json` declaring an HTTP MCP server and a command hook (the manifest Codex 0.160.0 reads first, ahead of `.codex-plugin`, `.claude-plugin` and `.cursor-plugin`), `agents/` or `commands/` directories, a `.claude-plugin/plugin.json` or a lowercase `skill.md`, and the witness stayed unchanged in both a vendor plugin and the reviewed hasna-codex hook plugin. Raw binding mode and the vendor-refresh guard already refused these trees, so semantic mode was weaker than both and failed silently. Capture and guard-time verification now refuse with `CODEX_SEMANTIC_CACHE_WITNESS_UNSUPPORTED` when a version root holds the root `plugin.json`, a `.claude-plugin` or `.cursor-plugin` manifest directory (at any depth), a root `hooks.json`, `commands/` or `agents/`, or a skill document not spelled exactly `SKILL.md`; when a bound location (`.codex-plugin`, `.app.json`, `.mcp.json`, `hooks`) appears in another case; when `hooks.json`, `.mcp.json` or `.app.json` appears nested in any case; and when a capability name sits beside the versions as a materialization. Names compare without regard to case, including the Kelvin sign and long s. The capability locations now live in one shared module (`codex-plugin-capability-paths.ts`) that the vendor-refresh guard and the reviewed hook dependency closure also read, so the modes cannot diverge again; the vendor-refresh guard's behaviour is unchanged apart from that shared case fold. Existing semantic bindings keep their v1 format: guard-time verification already recaptures the witness from the live cache, so a binding captured by 0.10.76 or earlier keeps passing only while its cache holds none of these paths, in which case the new capture is byte-identical, and refuses as soon as one appears. A station whose cache already holds such a path fails closed at its next guard run and needs a fresh discovery review; re-running `rebind-cache` refuses while the path is present. Raw mode, the vendor-refresh warning path and same-name version bumps without new capability paths are unchanged.

## 0.10.76

### Patch Changes

- Let Skills write into a Codex home on upstream Codex builds that have no `corpus-admission-inspect`, such as 0.160.0 and 0.162.1, through a bounded interim fallback. Every write previously required the native admission lock and inspection, which these builds never provide, so `skills hook install --agent codex --discovery-inputs <file> --apply` always refused with `CODEX_CORPUS_ADMISSION_REQUIRED` and `skills hook native-catalog` with `CODEX_NATIVE_SKILL_CATALOG_CAPTURE_FAILED`. The fallback applies only when neither the native lock nor a legacy `.native-corpus-admission.lock` exists, the selected executable passes the existing identity checks (including `codexSha256`), `codex help corpus-admission-inspect` exits 2 with the exact unrecognized-subcommand line, the control `codex help exec` exits 0, and `codex --version` is exactly `codex-cli X.Y.Z`, optionally with a semver prerelease suffix; any other outcome refuses as before. Each probe runs with only `PATH`, `HOME` and a fresh, empty `CODEX_HOME` that Skills creates for it in `<Skills data root>/codex-probe-homes/` and removes afterwards without following symlinks, so upstream's per-launch helper aliases and `.env` never touch the Codex home or any directory Skills did not just create. Writes hold an exclusive Skills-owned kernel lock at `<realpath(dirname(codex home))>/.hasna/skills/codex-corpus-locks/`, keyed by the home's physical identity and independent of data-root overrides; for a project-level `.codex`, or a symlinked `~/.codex`, that lock file sits in the target's parent tree, for example `<project>/.hasna/skills/codex-corpus-locks/`. An unsafe lock or probe location refuses before anything is probed or created, and the lock and probe state are never created under the Codex home itself. Preimage, rollback and readback checks are unchanged, and lease rechecks also verify the lock, the home's identity and the executable. Every receipt or JSON result from a fallback write records `nativeAdmission: "unavailable"` with the probe record (launcher path, sha256, size, version and exit codes); native-route receipts are unchanged. Refusals keep `CODEX_CORPUS_ADMISSION_REQUIRED` and may add one fixed reason: `native-lock-present`, `executable-unverified`, `probe-inconclusive`, `command-present`, `writer-busy`, `skills-lock-unavailable` or `lease-changed`; the `skills hook native-catalog` command still reports `CODEX_NATIVE_SKILL_CATALOG_CAPTURE_FAILED`. The public `removeSkillForAgent` and `removeManagedAgentSkill` keep their boolean results and use the fallback only with a new synchronous `onCodexAdmission` function; any other defined value, or a callback that returns a promise, refuses with the new `CODEX_CORPUS_ADMISSION_RECORD_INVALID` before anything is removed. The guarantee is weaker than native admission: upstream Codex's own refresh writes are not coordinated, only Skills writers exclude each other, and preimage checks refuse only the races they detect. The fallback is retired in the first release after the Harnesses enrollment/inspect route is live for that build line.

## 0.10.75

### Patch Changes

- Name the accepted skill name when a caller uses the end of a canonical slug, and refuse a stray word given to a verb that takes no argument. Suggestions came only from edit distance, so `skills load fleet-refresh` offered nothing for `instructions-fleet-refresh` (13 edits away) and blamed "this profile or project lock" for a name that is in no profile. Close-name suggestions now rank a candidate that owns the query as a whole leading or trailing segment first, then one that contains every word of a multi-word query, then the previous edit-distance matches; the containment scan needs at least three characters. The public `findSimilarSkills` export uses this ranking, so its results change in three ways: containment matches come first, matches at equal edit distance are ordered alphabetically instead of by registry order, and the query is trimmed, so an empty or whitespace-only query returns `[]`. An exact profile selection resolves the name before the version. The error code stays `SKILL_NOT_SELECTED`, but its message is no longer the single sentence "The requested exact skill version is not selected by this profile or project lock."; it now says which case applies: an unknown name (naming it, with close accepted names (canonical slugs or aliases) when any are found, and the accepted form), a name selected at a different version (naming both versions), or an empty version. `show` and `info` resolve their suggestion with the same predicate as the read (hosted or local) and keep the local answer if that resolution fails. A verb that declares no positional argument (`skills categories typo`, `skills list typo`, `skills doctor typo`) now exits 1 with nothing on stdout and names the verb and its arity instead of running and ignoring the word; the default command, `skills mcp` and verbs that declare their own arguments, including variadic ones, are unchanged.

## 0.10.74

### Patch Changes

- Run an instruction skill through its explicitly declared first command and supported runtime while keeping prose-only instructions non-executable. CLI, MCP and local execution use the same entrypoint validation; a missing command file or conflicting runtime entrypoint refuses before execution. Existing selection custody, runtime restrictions and secret binding checks remain in force.

- Preserve declared command and input arrays when porting instruction skills through the existing manifest normalizers. A declared command whose entry file is missing now fails validation instead of succeeding after silently discarding the declaration. Nested fields still follow the existing parser normalization.

- Validate the original native skill inventory before reusing a saved discovery review, both while planning and immediately before applying a bridge reinstall. An unexpected Codex vendor copy previously gained an exact-path disable before the post-write check, so strict reinstall incorrectly reported success. The shared discovery guard now refuses before configuration, policy or backup writes while keeping genuine bridge protection repairs available. Strict-copy remediation remains exact; live prompt vendor exceptions and verified native-policy handling are unchanged.

- Let `skills hook install --agent claude --discovery-inputs <file>` accept the stored witnesses that `discovery-binding` reports as `retained-absent`. An explicit review verified those sources with the absent retired version rule, which never reads them, and then still read them: a legacy full byte witness (`hashMode` omitted or `bytes`) of the retired version's `.claude-plugin/plugin.json` refused with `Reviewed Claude plugin manifest is missing`, and a legacy byte witness of its `.orphaned_at` marker was silently rewritten as a typed `claude-plugin-orphaned-at-v1` witness that pins absence (`sha256: null`). So an installer could get `ok: true` from `discovery-binding` and then have the same stored witnesses refused by `hook install`, after its own native write. The review now keeps every source the rule retains exactly as supplied: no manifest projection, no hook-file requirement and no marker conversion, so a historical byte witness keeps its meaning and a review of the stored witnesses reproduces the stored binding. It decides retention with the predicate the `discovery-binding` report uses, and refuses if a retained version directory reappears during the review. A missing manifest or marker outside the rule still refuses, and a retired version that reappears is checked file by file again; a fresh review of the present version then projects its manifest and converts its marker as before. `assertReviewedClaudeCacheClosures` and the plugin hook-file check needed no change: the first checks only registered cache roots, which the rule never retains, and the second applies only to a manifest the review projects. New end-to-end tests run `discovery-binding`, `hook install --discovery-inputs` through the built CLI and the prompt hook's check on a pruned version with legacy manifest, hook and marker witnesses, a missing manifest outside the rule, and a recreated version.

- Require a supported nonempty string for profile identity and revision before any provenance comparison. The completeness check tested `undefined` alone, but `undefined` is not the only shape the HTTP reader passes through: a station receipt carrying `null` or `""` for `profileId`, `profileRevision` or `workspaceId` fell past the check into the comparison, where the value failed equality and was reported `behind`/`REVISION_BEHIND` with a drift row derived from something that cannot be compared. Identity and revision must each be a nonempty string now; anything else is `unverified` with reason `INCOMPLETE_RECEIPT` and no drift, and the unsupported value is not echoed back into the receipt. Complete matching, behind and pinned receipts are unchanged, as are the omitted-field case and the three earlier repaired classes.

- Treat an incomplete provenance receipt as unverified instead of current or behind. The normal HTTP reader accepts a station receipt that omits `profileId` or `profileRevision`, and the comparison treated an absent field as a non-match: a missing `profileId` still satisfied the identity predicate and was reported `current`/`CURRENT_SCHEMA_MATCH`, while a missing `profileRevision` failed the revision equality and was reported `behind`/`REVISION_BEHIND`. An absent revision is not an older revision and an absent profile id is not the selected profile, so every receipt source now declares the identity fields it must record and a receipt that omits one is `unverified` with reason `INCOMPLETE_RECEIPT` and yields no drift, because nothing about it can be compared. Complete matching, behind and pinned receipts are unchanged. The successful authority read also stops reporting itself under the `REFERENCE_NOT_AUTHORITY` label.

- Fix three defects an independent review reproduced in the `skills provenance` receipt, at the owning abstraction rather than in the fixtures. **Identity now binds.** The receipt compared profile and revision only, so a pin held under a foreign authority or workspace was reported `current` with zero drift — the exact state the resolver refuses with `PROFILE_IDENTITY_MISMATCH`. The reference is now read through the resolver's own profile client, so the authority and workspace it compares are the ones the stored receipts bind to; a consumer whose identity differs, or whose source does not record a field the profile binds, is `IDENTITY_MISMATCH` and is never diffed, because rows across two identities would all be false. Each receipt source declares the identity fields it is expected to carry, so a station receipt (which records the workspace, not an authority) is not marked unverified for a field it never had. **Local and requested-station provenance are separated.** `--station` names the station whose authority receipt is read; it could relabel this machine's own activation, which belongs to the host. The activation consumer now carries the local host id with `idKind: "local-host"` and the authority receipt carries the requested station with `idKind: "requested-station"`, and the human output names them differently. **A reader's exception text is never carried.** The receipt echoed an `Error.message` bounded and control-character-stripped, which is not redaction: a credential inside it survived. Diagnostics are now a fixed vocabulary of `reasonCode` values plus fixed sentences and validated labels, so nothing from a foreign body can reach a receipt that may be shared. The receipt also states what it does not attest — published version and digest evidence, native discovery and locks, and live consumer adoption — so a clean result cannot imply them. Controls cover each defect and each fails against the previous head.

- Add a read-only `skills provenance` receipt that reports the Skills selection chain as separate facts instead of one number: the `selected` shared profile, this machine's `activated` snapshot, the station receipt the authority holds (`applied`), the exact revision a live session `pinned`, and the versions that session actually `consumed`. Only an explicit `skills sync` writes the station record, because the managed hook keeps station reporting off its blocking lifecycle path on purpose, so a station receipt that lags the activation is a reporting fact rather than evidence that the machine is adrift; and a session keeps its revision when the profile moves on, so an older pin is custody by design. Until now each surface showed one of those facts alone and none of them said whether a consumer was current, which is how an apply record gets read as adoption. Every consumer is now classified `current`, `behind`, `pinned` or `unverified` and always carries the reason, with a bounded `drift` list of the exact differing versions. Measured on station07 it reproduces exactly the four bundles whose versions differ between the `fleet` selection and the station receipt, while showing that machine's own activation as current. The command writes nothing — no pin, receipt, cache entry or station record — renders no skill payload and no credential, and with `--cached` or an unreadable authority reports the locally synced snapshot as its reference and every consumer `unverified` rather than guessing. `--session <id>` adds the session's pin and the exact versions it loaded.

- Separate binding CUSTODY from repairable bridge PROTECTION so `skills hook install` can repair the state it exists to repair. Reusing a saved discovery review prechecked the whole managed bridge and refused with the bare `run skills hook install` — the command that had just refused, whose own precondition is what is broken — so the documented repair path was circular on the station that reported it. The recheck now has two halves. Custody (the managed bridge binding, home, alias set, agent, command/profile binding and reviewed discovery) still gates reuse, and a drifted review still requires a fresh explicit `--discovery-inputs` review and is never silently reused as an automatic one. Protection (the native plugin bytes, permission and hook rules, and bundled-skill switches) is written by the same plan, so it is asserted in FULL after the writes and before the receipt; a plan that does not repair it is refused. A zero-change plan now runs that proof too, because it was the one path that could report a successful install without evidence — `applyAgentIntegration` returned early for a plan with nothing to write. Hermes native shell-hook trust is deliberately not deferred: it is the user's own consent and no Skills write creates it, so it stays a condition before planning and again before applying. One shared implementation serves both halves so they cannot drift apart, an unresolvable runtime still keeps its own `DISCOVERY_ROOT_UNRESOLVED` code instead of being reported as drift, nothing is written on a refusal, and the single `NATIVE_SKILL_DRIFT` prefix is preserved for the CLI's classifier.

## 0.10.73

### Patch Changes

- Add a read-only `discovery-binding` operation to `skills hook capture-claude-installer`, so installers can verify the stored Claude discovery binding in one call instead of re-capturing each stored witness. Per-file capture requires each file to exist and so refused witnesses that Skills keeps on purpose after Claude deletes a retired plugin-cache version, which made the Harnesses Claude plugin installer refuse with `PLUGIN_MANIFEST_REJECTED` while Skills accepted the binding. The request names only `policyPath`, which must be the package-owned `agent-policy.json`. The versioned `skills.claude-discovery-binding-verification/v1` result returns the policy SHA-256, the discovery binding digest, the agent, method and root count, and for every stored source its path, `hashMode`, stored digest and a `current`, `retained-absent` (with the `absent-retired-claude-version` rule, the absent root and the retained witness class) or `drift` status with a stable reason, plus every directory witness and an overall `ok`. Typed `claude-plugin-orphaned-at-v1` markers are checked with the marker witness itself: a rewritten timestamp or replaced file is `current`, an invalid marker (including a byte-order mark) is `MARKER_INVALID`, a deleted marker in an existing version is `MISSING`, and markers under a deleted version with a current registered sibling are `retained-absent`. The README states that installers must not restore or rewrite marker files and must act on this result instead. It runs the prompt hook's own discovery verification and the same retention predicate, now shared through one helper, so the two cannot diverge. Settings and registry sources are never retained. Policy and binding read or parse errors refuse with stable codes; the operation writes nothing and keeps the shared producer identity check.
- Stop existing reviewed Codex bindings from raising `NATIVE_SKILL_DRIFT` after every Codex launch. Codex 0.162.1 (`tui/src/screen_reader.rs`) writes the boolean `tui.screen_reader_detection_done` receipt into `config.toml` on every TUI or desktop launch while the key is missing, which changed the digest of every `codex-settings-v1` to `codex-settings-v5` witness. Verification of those witnesses now also accepts a document that differs from the reviewed one only by that receipt, added, removed or flipped (V6 already omitted it). Each case is proven by reproducing the stored digest under the witness's own unchanged digest function, so no digest changes meaning and verification alone records or rebinds nothing. A non-boolean receipt, any other TUI key (including the `animations = false` Codex adds when it detects a screen reader) and every other change still drift, including Codex's `[projects."<dir>"]` trust entries. A planned Skills write to `config.toml` rebinds the witness to the written document and may adopt only that receipt; a receipt beside any other difference refuses the write. On the live prompt hook, a vendor plugin refresh that coincides with the receipt keeps its visible warning.
- Make the `NATIVE_SKILL_DRIFT` refusal for unexpected native skill copies name remediation that works. It recommended `skills migrate native --agent <agent> --project <working-directory> --include-unmanaged --include-vendor --json`, which on 0.10.72 refuses (`plugin hooks require a separate no-skill-injection review`) whenever a configured plugin declares hooks, because `--include-vendor` resolves configured plugin discovery. The refusal now names one step per kind of copy it lists, for the guard call that refused:
  - user and project copies: the same command without `--include-vendor` (plus `--allow-root-aliases` when the binding records root aliases), which never resolves configured plugins;
  - in the live Codex prompt hook, copies in an OpenAI Codex marketplace (`openai-bundled`, `openai-curated`, `openai-curated-remote`) that a disable rule by plugin-qualified name would retire: a Codex `[[skills.config]]` rule such as `name = "sites:sites"` with `enabled = false` in the named `config.toml`. Codex refreshes these caches on its own, and the hook accepts a copy disabled this way only when all its other conditions hold: no Skills-managed or Hasna marker, the remote install receipt for `openai-curated-remote`, a plugin whose every cached version passes the refresh safety check, and no rule that enables the copy. The name rule is offered only when the copy meets them;
  - other Codex plugin-cache copies in the live hook, including OpenAI marketplace copies that fail one of those conditions: an exact-path disable rule, with a note to remove rules that enable skills first when one is present (followed by the refreshed binding, as below);
  - a refreshed binding, `skills hook install --agent codex --discovery-inputs <reviewed-file> --apply` with a fresh discovery review (without `--discovery-inputs` on an automatic binding, and with a fresh `--codex-native-catalog` for a plugin Skills has enrolled), which writes and records the disables itself. This is the step for Codex system skills under `.codex/skills/.system`, which `skills migrate native` never archives; for copies of an enrolled plugin; for plugin-cache copies once the hook has tolerated a vendor configuration change; and for every plugin-cache copy when a strict guard call refused;
  - other vendor copies: `--include-vendor` with a reviewed `--discovery-inputs` file.

  Strict guard calls are every Codex guard call except the live prompt hook: `skills hook install --apply` reusing a saved review, `skills hook trust` enrolment and reconciliation, and witness and review-artifact upgrades. They do not accept a hand-added name rule, so they never offer one.

  A config-edit step names the refreshed binding as its follow-up whenever the resulting `config.toml` would no longer match the binding's recorded witness, judged by that witness's own digest mode and the same screen-reader receipt tolerance verification applies: always on an automatic binding, always when a rule that enables skills must be removed (enabled rows count in every witness), and on reviewed bindings whose witness counts disable rows (raw, `bytes`, `codex-settings-v1`) or whose configuration already differs from what was recorded. Typed `codex-settings-v2` to `v5` witnesses ignore appended disable rows, so there the edit alone clears the refusal. Names and paths are escaped and bounded like the path list. No guard decision changed.

  New tests confirm that a new vendor skill whose qualified name Codex config already disables does not block the live Codex prompt hook, and that disable rows for removed versions, skills, plugins and marketplaces block neither the live hook nor the strict guard. They also follow every named step, including its follow-up, until the guard that named it accepts: for each config-edit step on raw, `bytes`, `codex-settings-v1` and typed V2 to V5 witnesses, with and without an enabling rule; for strict callers, system skills and automatic bindings; and through the real CLI for a strict `skills hook install` and an enabling rule on a reviewed V4 binding.
- Stop a valid owner configuration key that this Codex build does not know from breaking native hook trust enrollment, reconciliation and native catalog capture. Skills started its owned `codex app-server` with `--strict-config`, which turns every unknown key into a startup error; station01 failed on `skills.native_allowed_paths`. It now starts the app server the way Codex itself runs, non-strict, so such keys are ignored exactly as in the real consumer. What strict mode also prevented stays refused: when non-strict startup cannot load the configuration and falls back to defaults, its `Invalid configuration; using defaults.` startup notification now fails the whole connection with `CODEX_HOOK_TRUST_NATIVE_CONFIG_INVALID` (details are never forwarded), every per-request load still reports its own error (`hooks/list` and `skills/list` errors, a failed `config/read`), and enrollment and reconciliation still require `config/read` to return exactly the user layer Skills parsed.
- Stop native Codex skills below `node_modules` from reaching Codex without Skills inventorying or guarding them. Native inventory skipped every `node_modules` directory, but Codex 0.162.1 loads `SKILL.md` files below `node_modules` inside each of its skill roots (measured with `skills/list` on the native app server, offline, with a synthetic home): `~/.codex/skills/node_modules/<x>/SKILL.md`, scoped and nested packages, the same layout in `~/.agents/skills` and a project's `.codex/skills` and `.agents/skills`, and below a cached plugin's skills root, to six directory levels. So a copy such as `~/.codex/skills/node_modules/x/SKILL.md` passed `skills hook check` and the live prompt guard. Codex inventory now walks `node_modules` in those skill roots and configured plugin skill roots, and in the plugin cache only where it can lie in a plugin skill root (a version's `skills` directory, a manifest-declared skills path, or a marketplace, plugin or version directory named `node_modules`; an unreadable manifest walks every `node_modules` in its version). A plugin version's own dependencies, `node_modules` outside a skill root and dot-named directories such as `node_modules/.pnpm` stay unscanned, matching Codex; other agents keep their existing rule, and the depth and entry limits are unchanged, so a copy deeper than the ordinary-root limit refuses as before.
- Admit the user-scoped Claude directory marketplace writer on the exact 2.1.300 version. In synthetic homes, its `plugin marketplace add` and `plugin install` writes to `settings.json`, `known_marketplaces.json`, `installed_plugins.json` and the plugin cache match 2.1.299 and 2.1.293 byte for byte, after normalizing the home path and generated timestamps. Unmeasured versions such as 2.1.301 and project scope still refuse.
- Accept a Claude prospective review when a present project `.claude/settings.json` or `.claude/settings.local.json` carries only allowlisted settings, such as the permissions-only `~/.claude/settings.local.json` Claude writes when it saves a permission rule during a user-scope install. Binding that file byte-exact would break every time Claude saves a rule. The file is exempt from the reviewed discovery sources only when all of the following hold:
  - it is one of the two project settings files, and no other expected source (the target settings or the user settings) shares its path;
  - the reviewed discovery sources omit it;
  - its current bytes match its preimage SHA-256; a mismatch refuses with `<name> preimage changed`;
  - those exact bytes are strict UTF-8 without a byte-order mark and parse as one JSON object within the native JSON witness limits, with no comments, trailing commas, trailing content or duplicate keys at any depth;
  - none of `enabledPlugins`, `extraKnownMarketplaces`, `additionalMarketplaces` or `skillOverrides` is present at any value, including `null`, `{}` and `[]`;
  - every top-level key is on the allowlist with its type: `permissions` (an object), `outputStyle`, `model`, `theme` and `effortLevel` (strings), and `verbose` and `spinnerTipsEnabled` (booleans);
  - `permissions` holds only `allow`, `deny` and `ask` (arrays of strings) and `defaultMode` (a string).

  Anything else keeps the file required, including `env` (Claude reads `CLAUDE_CODE_PLUGIN_DIRS` from it), `hooks`, `permissions.additionalDirectories` (Claude loads skills, commands and agents from those directories), `__proto__` and unknown keys. The allowlist names settings reviewed as not configuring plugins, marketplaces, skills, hooks, extra directories or the environment; it does not prove that Claude cannot discover anything from the file. A present unreviewed file that fails the parse, discovery-key or allowlist checks refuses with the reason appended to the existing `does not bind every current user/project Claude settings and registration source` refusal. Each exempt file, present or absent, is re-checked against its exact preimage after discovery and again before the result. A change or removal in between refuses with `<name> preimage changed`, and a creation with `<name> was absent at review but is now present`. The live hooks' project check still runs on top. User settings, `known_marketplaces.json` and `installed_plugins.json` are never exempt.
- Treat `additionalMarketplaces` as a Claude project discovery key in the live project check (`assertProjectDiscovery`) as well, because Claude 2.1.300 rewrites it into `extraKnownMarketplaces` on every settings read, including local settings. An unreviewed project `.claude/settings.json` or `.claude/settings.local.json` that declares it now refuses with `NATIVE_SKILL_DRIFT`, like the other discovery keys.

## 0.10.72

### Patch Changes

- Keep Codex prompts running after a vendor plugin refresh that Codex configuration already retires, without any native fallback. On the live Codex prompt hook only, a vendor plugin-cache copy is exempt when all of the following hold:
  - it is package-classified content in `openai-bundled`, `openai-curated` or `openai-curated-remote` (exact names), with Codex's remote install receipt where Codex writes one;
  - it carries no Skills or Hasna marker;
  - every cached version of its plugin passes the same fail-closed vendor refresh check as the membership tolerance below, and no version is a link;
  - a `[[skills.config]]` exact-path or plugin-qualified-name rule (for example `name = "sites:sites-remix"`) disables it and no rule enables it. A whole-plugin `enabled = false` table alone is never enough, because remote state can enable a locally disabled remote plugin.

  A copy the inventory sees and no rule disables still blocks; a plugin that could load anything the inventory cannot see (another manifest location, hooks, extensions, MCP servers, commands, agents or a hidden skill root) gets no exemption at all. The exemption only adds to the guard's existing ones: exact-path disables in any plugin-cache marketplace and reviewed plugin controls stay accepted on the live hook. Once the hook tolerates a witness change below, which the strict guard refuses outright, plugin-cache copies are exempt only through the vendor rule.
- On the same hook, tolerate with a visible `systemMessage` warning only the discovery-witness changes a vendor refresh provably makes:
  - appended vendor disable rules or vendor plugin `enabled = false` tables in `config.toml`, proven by reproducing the reviewed digest (plugin activation stays strict). Candidates are tried smallest edit first within a 128-candidate bound; a change beyond it refuses;
  - directory membership under an allowlisted vendor marketplace whose every plugin version has only a `.codex-plugin/plugin.json` manifest with known metadata keys, the default skills root and at most the `./.app.json` connector declaration every current vendor plugin has, with an `.app.json` that passes the same strict connector validation as reviewed plugin controls; no hooks, commands, agents, extensions or MCP servers in the manifest or at their default locations; no root, `.claude-plugin` or `.cursor-plugin` manifest; no link; and no skill hidden from the inventory.

  These are classified at their source as typed witness changes, never by message text. Every other copy and change, and every install, trust, migrate and sync check, still refuse with unchanged messages. Nothing is recorded or rebound.
- Stop long-running sessions from failing every prompt with `SESSION_RECONCILIATION_REQUIRED` after their profile moves on. When renewal of an expired session pin is refused for the same profile, authority and workspace, the managed prompt hook of every maintained agent (Claude, Codex, Gemini, Cursor, Sumi, OpenCode, Hermes) now applies the existing `skills sessions reconcile` planner and applier to the already authenticated current revision: it archives the old receipt, writes the new pin under the existing receipt precondition and lock, retains unchanged loaded skills, retires changed or removed ones and delivers context for the prompt. The first hook context that succeeds and reaches the agent then names each retired loaded skill once, with the command to reload its replacement (Cursor shows it at session start, Sumi on its context restoration call; plain `skills context` never consumes it).
- Keep today's refusal for identity mismatches, unreadable receipts, integrity and lock failures, an unavailable authority and anything the planner refuses. A migration that cannot finish inside the four-second renewal window keeps `SESSION_RECONCILIATION_REQUIRED` and says so; no refusal code was added, so installed Sumi plugins stay byte-identical. Explicit `skills sessions reconcile` is unchanged. Operators turn automatic migration off with `skills config set sessionPinMigration off --global`; `skills context` gains the matching `--auto-migrate-session-pin` flag (requires `--auto-reconcile-safe`).
- Never migrate a session created from a project lock. A session started where `.skills/selection.lock.json` exists records that lock (its path and the SHA-256 of its bytes) as `projectLock` in its receipt, and its subagents inherit the record. Such a session is never migrated automatically, from whatever directory it later prompts. A session without the record, including every existing one, is not migrated while a lock is present or unreadable in the prompt's working directory or any ancestor. The check runs before and after the authority read and again under the session write lock immediately before the pin is written, so a lock created meanwhile still governs. In these cases the hook keeps today's refusal and leaves the pin and the lock unchanged. A loaded skill whose lifecycle epoch rotated while its bytes stayed the same also keeps the refusal instead of being revived silently.
- Remember deterministic migration refusals. A project lock, a rotated epoch, a planner refusal or any other non-transient refusal writes a five-minute refusal record of the new kind `managed-hook-migration-refusal`, so later prompts repeat the refusal without resolving the profile again. Timeouts, an unavailable authority and write-lock contention are never remembered. Write-lock contention now keeps its own `SESSION_WRITE_BUSY`. A failure after the new pin was written reports `SESSION_RECONCILIATION_INCOMPLETE` instead of a refusal.
- Only the migrator that commits the pin writes the retirement notice, under the session write lock after the receipt precondition held; a concurrent migrator that loses can no longer overwrite it. Delivery marks the notice under the same lock and leaves it pending while another writer holds that lock.
- The opt-out fails closed: migration runs only when `lstat` finds no global configuration entry inside an existing data directory, or the entry is a regular file holding a JSON object without `sessionPinMigration` or with exactly `"auto"`. A symlink (dangling or not), a non-regular entry, a missing or dangling data directory, an unreadable or malformed file, a truncated write, a non-object document, a retired key or any other value keeps the refusal. `skills config set sessionPinMigration` without `--global` is refused, because only the global value is read.
- Stop reviewed Claude discovery from raising `NATIVE_SKILL_DRIFT` on every Claude start because Claude rewrites the `.orphaned_at` timestamp at a plugin-cache version root (`.claude/plugins/cache/<marketplace>/<plugin>/<version>/.orphaned_at`). Byte and path captures of that exact path, and a fresh explicit review of a plain byte or `path-bytes` witness of it, now record a typed `claude-plugin-orphaned-at-v1` witness that binds the marker's presence but not its bytes or inode. Each capture and check still refuses anything but a regular, non-symlink, user-owned file of at most 32 bytes matching `^[1-9][0-9]{12}$`. The name stays in directory membership, and a typed marker under a pruned retired version keeps the existing retired-root exemption. Other depths, other names and Skills-owned producer trees keep exact byte witnesses; stored byte witnesses of the marker keep their meaning until one fresh review.
- Certified Claude managed-cache snapshots now also require the marker to be exactly 13 bytes, so a UTF-8 byte-order mark before the timestamp is refused.
- Accept a Claude prospective review when the project `.claude/settings.json` or `.claude/settings.local.json` is absent with a null preimage, the reviewed discovery sources omit it, and no other expected source (such as the target settings) shares its path. Each exempt file is re-checked as absent after discovery and again before the result. Every present settings and registration source is still required.

## 0.10.71

- Admit the user-scoped Claude directory marketplace writer on the exact 2.1.276, 2.1.278, 2.1.282, 2.1.287, 2.1.296 and 2.1.299 versions measured on the fleet. Keep 2.1.293 support and reject unmeasured versions and project scope.

## 0.10.70

- Add opt-in V6 Codex settings witnesses that bind reviewed hook declarations and their referenced local stdio MCP providers, including higher-precedence project overrides. Preserve V1–V5 meanings, harmless display changes and unrelated ordinary MCP changes; refuse unsupported routes and unproved source populations without automatically migrating existing witnesses.
- Preserve native selection for routine retained plugin versions while refusing ambiguous mixed-version ordering. Keep native activation, trust and corpus admission separate from the conservative declared-route review.
- Add explicit executable integrity witnesses using the existing custody, race and aggregate-budget guards, without increasing raw text-source limits.

## 0.10.69

- Serve `tools/list` in `skills-mcp` with JSON Schema converted by the package's own zod. `bin/mcp.js` bundles zod and loads only the MCP SDK from the consumer's `node_modules`. Since 0.10.61 the SDK's own `tools/list` converted the tool schemas with whatever zod the SDK resolved, and failed or degraded whenever that zod was older than the bundled 4.5.4:
  - It failed with `ctx.deferred.push` undefined for consumers that lock zod 4.3.x or 4.4.x, and for npm trees whose own zod is 4.2.0 to 4.3.5.
  - It advertised degraded schemas for npm trees on zod 3.25.x or 4.1.x.

  The new output matches the SDK's own conversion field for field, including tools registered with the positional `tool()` form. Argument validation stays with the SDK, and the `zod` and `@modelcontextprotocol/sdk` ranges are unchanged.
- The installed consumer receipt adds a static `mcp-binary-surface` check. That check confirms `bin/mcp.js` imports only the MCP SDK and bundles one zod. It also checks that the `tools/list` handler is present, by name only; the handler's behavior is covered by unit tests.
- The packed MCP consumer layouts run in the new unprivileged `skills-consumer-gate` workflow, never in the publish job:
  - bun at the declared zod floor and at the declared range;
  - npm with zod 4.3.5, 3.25.76 and 4.1.13.

  Each layout runs a valid call and three invalid calls refused with -32602, and every layout must list identical tools. Locally, `verify:consumer-mcp` runs the two bun layouts and only the npm 4.3.5 layout unless `--npm-split-zod` is given.

## 0.10.68

- Admit the exact Codex 0.162.1 hooks, qualified skill catalog and installed-plugin review contracts, which are unchanged from 0.162.0. Preserve exact version-bound review evidence, future-version rejection, executable trust and independent native corpus admission.

## 0.10.67

- Accept the documented local-marketplace `interface.displayName` object and optional hook-file `description` metadata during guarded Codex cache review. Preserve exact reviewed hook bytes and refuse unknown metadata or changed capabilities.
- Treat nested application source directories named `hooks` as ordinary cache assets. Native `hooks.json` files, direct plugin hook directories and explicit hook selectors remain guarded.

- Export `getSkillRequirementsFromContent` and the `SkillRequirements` type from `@hasna/skills/sdk`, so SDK consumers can derive a skill's environment variables, system dependencies, CLI command and npm dependencies from content they already hold instead of copying the parser. The helper is unchanged: its result depends only on its arguments, and it reads no registry, file, environment, install state or network and does not mutate its inputs. Hosted (`premium` or `remote`) skills still list `HASNA_SKILLS_API_KEY` in place of `SKILLS_API_KEY`. Its environment-name scan no longer writes shared `RegExp` state, and `texts` now accepts a `readonly string[]`. The installed consumer fixture checks the export's declarations and runs fixed-input, frozen-input and poisoned-ambient checks against the packed archive.

## 0.10.66

- Preserve reviewed Codex hook-capability plugin parents in semantic discovery witnesses while binding their exact marketplace, plugin, hook, manifest, and enabled-settings identities. Refuse additional app/MCP capabilities and ambiguous source witnesses.

## 0.10.65

- Restore already loaded Skills context in Sumi continuation and compaction events without treating native checkpoints or message history as a new owner prompt. Preserve the full native model context and existing hook input limits; ordinary owner prompts still match and load newly selected skills.
- Preserve bounded, branded Skills hook refusal reasons and recognize exact prior managed Sumi plugin renderers during guarded upgrades. Native discovery, integrity and configuration checks remain enforced.

## 0.10.63

- Retain explicitly reviewed immutable Codex catalog artifacts as exact private bytes under the resolved Skills data directory, with their original path and digests. Removing the original scratch copy no longer breaks hooks; live configuration, plugin and native trust witnesses remain enforced.
- Add guarded `skills hook retain-review-artifact` planning and application for one exact legacy reviewed catalog witness. Require the original bytes and current policy digest, preserve the old policy and session pins, and refuse missing, changed or unsafe evidence without capturing a replacement.

## 0.10.62

- Verify a declared target runtime’s read-only consumer prerequisites before switching Skills launchers. Missing or incompatible Sumi path readers refuse activation while retaining the prepared rollout receipt, old runtime, launcher bytes, configuration and session receipts.
- Report undeclared legacy targets as unverified and document the independent exact-target preflight required when first upgrading from 0.10.61. Receipt-based rollback remains supported.

## 0.10.60

- Add `skills hook capture-claude-installer` so installers can obtain versioned discovery witnesses through their configured Skills CLI, including retained-runtime launchers. The read-only command binds and rechecks the running CLI and runtime, delegates to the existing witness implementations, and returns bounded diagnostics without exposing input contents. It does not install plugins, change native configuration, or replace the prospective candidate review.

## 0.10.59

- Model Claude 2.1.293's user-scoped marketplace source setting during prospective plugin review. Installers explicitly declare the directory-source operation; Skills derives its exact path from the reviewed frozen candidate and preserves unrelated settings and marketplace entries. Preflight all authoritative marketplace and installed-plugin rows, including foreign entries and scopes, before the native parser can discard unsupported metadata. Preserve supported directory/GitHub entries and foreign Git revisions. Omission keeps the existing review contract.

## 0.10.58

- Admit exact `codex-cli 0.162.0` for native hook transport, qualified skill catalog capture and installed-plugin review after native acceptance. Neighboring releases and prerelease/build variants remain unsupported; native corpus admission is separate and still requires an admission-capable build.
- Allow up to 10 seconds for an owned native child to close after its existing one-second direct-child termination grace. The shared corpus admission lease remains held until the child actually closes.

## 0.10.57

- Add `skills hook review-claude-candidate` for installers to validate a frozen Claude plugin candidate before changing native state. The read-only check binds the candidate, current discovery, selected scope and complete proposed configuration while preserving unrelated plugin registrations and settings. The installer must verify its actual consumer identity, perform the review before marketplace activation, and verify the resulting native state; this check does not make native installation atomic.

## 0.10.56

- Require explicit Claude discovery reviews to cover each registered active cache manifest, skill root and hook source before installation. This prevents an incomplete old-cache-only review from breaking prompt hooks after cache retirement. Distinct project registrations, exact byte witnesses and reviewed absent manifests are supported; hook behavior still requires the existing no-skill-injection review. Existing policies and session pins remain unchanged by the package update.

## 0.10.55

- Identify exact pinned skills in CLI and SDK session inspection, including slug, version, bundle digest and loaded state. Reconciliation preview now names retained, retired and unloaded selections, explains removed or changed bundles, and lists exact replacements and added target selections. The metadata delta is bound to the reviewed plan digest; inspection and preview leave receipts unchanged, and existing counts, CAS, expiry and lock checks remain intact.

## 0.10.54

- Preserve reviewed `claude-plugin-manifest-v1` witnesses when Claude removes an entire retired plugin cache version and unchanged settings and supported registrations still prove a distinct active replacement. Discovery verification and hook rebinding retain the original reviewed digest. Active manifest changes, missing active hooks or cache, inconsistent registrations, unknown native skills and changed returning manifests still refuse.
- Admit exact Codex `codex-cli 0.161.0` for hook trust, the native skill catalog and installed-plugin review after released-binary catalog acceptance. It uses the existing capabilities of 0.160.1; unsupported versions, pre-release or build suffixes and disagreement between the version command and handshake still refuse. Corpus admission is unchanged: upstream Codex has no `corpus-admission-inspect`, so guarded native loading still requires an admission-capable Hasna-patched build.

## 0.10.52

- Add an explicit `claude-marketplace-entry-v1` witness for one plugin entry of a Claude `marketplace.json`, selected by exact marketplace and plugin name. It binds the marketplace name, `metadata.pluginRoot`, `allowCrossMarketplaceDependenciesOn` (its value or its absence, for every entry) and the entry's identity, source and component or command-bearing fields, and omits display metadata, so Claude's own catalog refreshes no longer invalidate a review of a plugin declared only by its entry (such as `strict: false` `swift-lsp`). Its canonical JSON sorts object keys under the domain prefix `hasna.skills.claude-marketplace-entry.v1\0`, unlike `claude-plugin-manifest-v1`, which keeps key order. Unknown keys, a missing, duplicated, case-ambiguous or renamed entry and unparsable JSON refuse; an unknown-key refusal names the mode, the marketplace and the exact key path (for example `claude-marketplace-entry-v1: unknown key "plugins[swift-lsp].x" in claude-plugins-official`) and never a value, and is cleared only by a fresh review and an exact re-pin through `skills hook install --discovery-inputs`. Capture with `skills hook witness --kind claude-marketplace-entry-v1 --path <marketplace.json> --marketplace <name> --plugin <name>`. Existing witnesses keep their meaning. The managed policy accepts the new hash mode, so consumers that bundle the verifier must ship it before a policy uses it.

- Require root or current-user ownership of every directory that `skills hook project-claude-settings` (`planClaudeManagedHookProjection`) and the Codex hook trust commands (`skills hook trust --agent codex` and `skills hook trust reconcile`) walk, and walk the directories they previously skipped. A directory owned by another non-root account can have its entries renamed or replaced by that account whatever its mode, yet these paths previously admitted it when it was not group- or world-writable. Every walked directory must be a real directory owned by root or the current user and writable by neither group nor others, unless it is a root-owned sticky directory; on macOS the Claude projection also reads its ACL, as before. The walks cover the directory chains of the hook command, of the physical Skills entry and its `package.json`, of a pinned launcher and of the Bun it runs, and, in the Codex path, of every hook trust file it snapshots or writes. The release-proof package tarball that `skills hook trust reconcile` can check is bound by its size and SHA-256, not walked. Two of these chains were not walked before: the pinned Bun's, which was checked only as a file (the Claude projection now also reads the Bun file's macOS ACL and rechecks the Bun before it returns), and, in the Codex path, the command's own. The Codex command must now be an exact absolute, normalized path, as the Claude projection already required: a relative command (including one found through a relative PATH entry), a `.` or `..` component, or a repeated or trailing slash refuses, because `..` after a linked directory reaches one file in the kernel and another in a textual walk. Its directory chain is then walked after the verified macOS `/tmp`, `/var` and `/etc` root alias, not only through its physical target. A pinned Bun must likewise be named by its exact physical path, with no link or `.`, `..` or repeated slash anywhere in it. The command may be one alias at most: a symbolic link, owned by the current user (in the Codex path, by root or the current user), that names its physical target directly, by an absolute path of plain names or a relative path whose only `..` steps lead out of the link's own directory. A chain through a second link or a linked directory, or a `.` or `..` step after a name, now refuses, because a link in such a chain could be re-pointed through a directory that no walk sees. The pinned launchers that `skills self-update` writes, and the single direct links that older updaters and package managers wrote, are unaffected. The Codex rechecks now repeat the whole command check and require the same physical command file, entry and pinned Bun, not only the same entry. Refusals: the Claude projection reports every case as `CLAUDE_MANAGED_HOOK_EXECUTABLE_UNVERIFIED`. The Codex path reports an unsafe directory, including a linked directory above the pinned Bun, as `CODEX_HOOK_TRUST_UNSAFE_PARENT`; a pinned Bun file that fails its file checks or is not named by a normalized path as `CODEX_HOOK_TRUST_SKILLS_LAUNCHER_UNVERIFIED`; a command that is not an exact absolute, normalized path as the new `CODEX_HOOK_TRUST_SKILLS_COMMAND_NOT_CANONICAL`; a command alias chain or a command link owned by another account as the new `CODEX_HOOK_TRUST_SKILLS_COMMAND_ALIAS_UNSAFE`; and, in a recheck, any change or refusal on the command side, including a command directory that has become unsafe, as `CODEX_HOOK_TRUST_SKILLS_COMMAND_CHANGED`, while the launcher bytes and the pinned Bun keep their own codes. The two new Codex codes are followed by a short fix hint that names no path; journals still record only the code. There is no allowlist: a prefix such as `/opt/homebrew` passes only when root or the current user owns it. Not covered by this change: the Codex hook trust walks read no macOS ACLs; `skills self-update` still checks only the Bun file it pins, not its directories, so it can pin a Bun (for example a Homebrew Bun in a directory another account owns) that these walks then refuse; the owner and mode of the directories above the Skills data directory (the Codex native skill policy's operator trust root) and above the plugin projection store's private directory are still not checked; and neither are the owner and directories of the Codex executable named by `--codex-command`. The macOS `/tmp`, `/var` and `/etc` root-alias check no longer compares the times of `/`, `/private` and the alias target, which entry churn in the sticky `/private/tmp` changed, so `/tmp`-rooted paths no longer refuse spuriously. These root-owned directories are still bound by device, inode, owner and mode, and their ACLs are still read.

- Stop `skills hook project-claude-settings` (`planClaudeManagedHookProjection`) from refusing with a spurious `CLAUDE_MANAGED_HOOK_EXECUTABLE_UNVERIFIED` on macOS when an unrelated process adds or removes an entry in any ancestor directory of the Skills executable during its ACL read, such as a shared TMPDIR or the home directory. The Darwin ACL check now binds a directory descriptor by device, inode, owner and mode; files keep their full identity, including times, link count and size. Every ancestor ACL is still read through its own descriptor and re-read by the final recheck, and an ACL grant or a group/other-writable mode on any ancestor still refuses.

- Verify Gemini discovery through the executable its review recorded, not only the caller's PATH. Gemini discovery reads its installed runtime through the `gemini` command, so a caller with a narrower PATH than the reviewing session (for example `env -i PATH=/usr/bin:/bin`, a launchd unit or a hook with a pinned PATH) could not re-derive the reviewed package and builtin witnesses, and Claude hook updates and Gemini's own guard refused with `NATIVE_SKILL_DRIFT: Configured native discovery roots changed`. `skills hook install` now records the resolved executable and its realpath target in the policy as `bridge.discoveryExecutables.gemini` (beside the Gemini binding, whose stored shape is unchanged). Verification always checks that recorded path and also looks `gemini` up on the caller's PATH: a PATH `gemini` with a different realpath target shadows the reviewed runtime and refuses with `NATIVE_SKILL_DRIFT`, naming both targets; when PATH resolves none, the recorded path alone is verified. A changed recorded target, package or builtin set is still `NATIVE_SKILL_DRIFT`. When the recorded executable no longer resolves, or a policy written before this change cannot find its runtime on PATH, and nothing else changed, the refusal is the distinct `DISCOVERY_ROOT_UNRESOLVED: gemini discovery cannot resolve its "gemini" executable: ...`, which names the agent and the command; any other change stays `NATIVE_SKILL_DRIFT`. The code stays blocking, and hooks show it instead of a generic failure. An install keeps a recorded executable that the PATH cannot see only while it still resolves; a dangling, missing or unreadable record is treated as none. Older Skills builds ignore the new policy field and keep their PATH lookup.

- Report `SESSION_RENEWAL_TIMEOUT` only for real deadline or abort signals of the renewal: an `AbortError` or `TimeoutError`, a bundle inspection `BUNDLE_TIMEOUT` or `BUNDLE_ABORTED`, or `SKILLS_API_UNAVAILABLE` from an aborted or timed-out request, which now carries a fixed abort cause. After the deadline, an authority that answered HTTP 429/5xx still reports `SKILLS_API_UNAVAILABLE`, and invalid data or programming errors fail as `SKILLS_CONTEXT_FAILED` again instead of the optional timeout. Inner bundle deadlines no longer fire early: the renewal rounds the remaining budget up instead of down, and bundle inspection re-arms its timer when Bun fires it before the deadline (measured up to 0.74 ms early on Bun 1.3.14; a 2 ms inspection deadline was reported after about 1.2 ms). A bundle-verification deadline that has already passed is now `BUNDLE_TIMEOUT` rather than `SKILLS_API_UNAVAILABLE`. Refusal records larger than 4 KiB are ignored unread.

- Separate a spent session-renewal budget from authority failures, and stop re-resolving the whole profile on every prompt after a definitive refusal. When the managed hook's four-second renewal window runs out, the context child now reports `SESSION_RENEWAL_TIMEOUT` instead of `SKILLS_API_UNAVAILABLE`, which keeps its meaning for an unreachable authority, HTTP 429/5xx and missing advertised lifecycle fences; the hook says the pin is unchanged and the next prompt retries, without sync or diagnosis advice. A `SESSION_RECONCILIATION_REQUIRED` refusal from automatic renewal is remembered for five minutes, bound to the exact receipt bytes, profile, authority, workspace and locally synced profile revision; within that window later prompts repeat the refusal locally (in the synthetic 806-selection repro, about 0.1 s instead of a 1.4 s resolve or a 4.1 s timeout per prompt). A changed receipt, a newly synced revision or the end of the window asks the authority again. The record only repeats a refusal: it never renews, authorizes or writes a pin, malformed or extended records are ignored, budget timeouts and HTTP failures are never remembered, and explicit `skills sessions reconcile` is unchanged. The installed hook runs its parent and its context child from the same runtime, so both sides change together; a host that pairs an older hook parent with this context child would report the new code as `SKILLS_CONTEXT_FAILED`.

## 0.10.51

- Separate a read-only schema and migration-ledger census from the epoch migration: the protected maintenance entrypoint gains `skills-maintenance maintenance inspect-schema --manifest census.json --operator-receipt receipt.json`, which requires its own unexpired authorization and operation ID and cannot reuse an enrollment or enrollment-inspection authorization. The operation takes no target, query, schema or table argument; it accepts only the explicitly configured PostgreSQL database (`HASNA_SKILLS_DATABASE_URL`; the maintenance entry does not read `DATABASE_URL`, unlike the server and the migrator, and a missing or non-PostgreSQL value refuses with `CENSUS_POSTGRES_REQUIRED`), refuses with `CENSUS_TARGET_MISMATCH` unless the connection resolves to the fixed public schema, and reads every owned table qualified to `public` (a missing owned table or column refuses with `CENSUS_SCHEMA_UNAVAILABLE`). It opens a separate repeatable-read, read-only transaction with a five-second statement timeout and a one-second lock timeout, and does not initialize the store, run migrations or backfill registry revisions. There is no `--apply` and no arbitrary-SQL option. The census is buildable and admissible independently of the epoch migration, which is unchanged. Documented in the repository at `docs/maintenance-census.md`, which is not part of the published package.
- Admit Codex `codex-cli 0.160.1` for native hook trust, the native skill catalog and the 0.160 installed-plugin review (local installation inputs, inert disabled plugins, remote refresh denials), as one more exact entry in the compatibility registry with the same capabilities as 0.160.0. Upstream `rust-v0.160.1` is the 0.160.0 content plus one remote stdio MCP environment backport (#51121); its app-server protocol schema is byte-identical and the native catalog acceptance test passes against the released binary. Those 0.160 plugin branches now read the registry instead of a literal version, and stored installation inputs record the reviewed catalog's version. `0.160.2`, `0.161.0`, pre-release, build-suffixed and other unmeasured strings still refuse, and so does a `--version` that disagrees with the native handshake. Corpus admission is unchanged and has no version gate. An upstream `codex-cli 0.160.1` has no `corpus-admission-inspect`, so every native path that holds the corpus admission still needs an admission-capable, Hasna-patched native build. Without one, `skills hook native-catalog` fails at the CLI as `CODEX_NATIVE_SKILL_CATALOG_CAPTURE_FAILED`, and hook trust and `install --apply` fail as `CODEX_CORPUS_ADMISSION_REQUIRED`. The managed policy now accepts 0.160.1 installation inputs and inactive-plugin reviews. Consumers that bundle the verifier must therefore ship this version first, because older code refuses a policy that carries them.

## 0.10.50

- Add an explicit `claude-settings-v4` Claude settings witness that also permits a top-level built-in `theme` (`auto`, `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`, pinned from the Claude Code settings reference). Custom and plugin themes, `skipDangerousModePermissionPrompt` and every permission, hook, environment and unknown setting stay bound. Opt in with `skills hook witness --kind claude-settings-v4` or `skills hook rebind-settings --agent claude --claude-witness-version 4`; existing v1/v2/v3 witnesses keep their meaning and the default rebind target stays v3. The managed policy accepts the new `claude-settings-v4` hash mode, so consumers that bundle the verifier must ship it before a policy uses it.
- `skills self-update --adopt-aliases` now also pins a bare symlink launcher that already targets the current runtime's entry, such as those a 0.10.48 or earlier updater leaves when it installs this version. It uses the same ownership, foreign and chain refusals, `.skills-alias-prev-<id>` backup, receipt and `--rollback-aliases` as any adopted alias; a launcher already pinned to the current runtime is left unchanged. Adoption fails closed with `ALIAS_PATH_UNSAFE` when an ancestor of the runtime package is group- or world-writable (umask-002 stations); the update path still writes pinned launchers there. Roll an adoption back before rolling back the runtime that installed those symlinks: that runtime rollback refuses with `LAUNCHER_DRIFT_ROLLBACK_REFUSED` while the adopted pinned launchers are in place. Alias rollback without a backup now also requires the exact old launcher shape, not only its target.

## 0.10.49

- Write pinned launchers instead of bare `bun` symlinks: the runtime updater now writes `env -i` launchers with `--config=/dev/null --no-env-file --no-macros --no-install --cwd=<trusted>` and a `#!/bin/sh -p` header for every managed `skills*` launcher in every PATH directory (including `~/.local/bin`, `~/.bun/bin`, `/opt/homebrew/bin` and `/usr/local/bin`), so a hostile working directory, environment or `BUN_OPTIONS` cannot execute repository code inside the tool process; hook children already get the same isolation. Launchers switched by the previous updater stay bare symlinks until the next `skills self-update --version <newer version>` run by this code; `--adopt-aliases` pins only aliases still pointing at an older install. `/bin/sh` must accept `-p` (bash, zsh, dash 0.5.11 or later); older dash refuses before any write. Launchers no longer pass `NODE_OPTIONS`, `BUN_*`, `DYLD_*`, `LD_*`, `NODE_EXTRA_CA_CERTS` or the proxy variables into the runtime; stations relying on those for a proxy or custom CAs must configure them for the runtime directly.

## 0.10.46

- Add explicitly reviewed Sumi settings witnesses that permit known display changes while preserving executable, plugin, permission and unknown configuration controls. Upgrade legacy reviews only with the exact preserved preimage and guarded policy readback.
- Emit a fixed, versioned Skills refusal from the Sumi plugin without exposing hook stderr or arbitrary reasons. Recognize the exact previous managed plugin for a guarded update; modified plugins remain refused.

## 0.10.45

- Preserve the exact Codex TOML text when Skills native configuration is already semantically current. Comment-only and formatting-only differences no longer rewrite managed configuration or invalidate its accepted witness; required configuration changes still apply.

## 0.10.44

- Add a caller-bound Codex native skill policy adapter to the native skill guard. In a Codex `SessionStart` or `UserPromptSubmit` hook that carries `native_skill_policy` (capability `host-path-allowlist-v1`), Codex plugin-cache copies count as inert only when everything below holds:
  - the policy is restricted to exactly the owned bridge, with non-host sources disabled;
  - the bridge bytes verify on every hook;
  - the claimed process is a real ancestor with a stable start time;
  - its executable digest is pinned in the managed policy (`bridge.codexNativePolicy.executableDigests`);
  - the native `debug verify-hook-policy` helper, over the inherited `CODEX_NATIVE_SKILL_POLICY_FD`, attests the same peer, raw stdin digest and policy (`native-hook-policy-peer-v1`).
  Anything missing, unknown or forged refuses as before. User and repository native copies always refuse. With no pinned digest (the default), the adapter refuses before running the helper.
- Add `skills hook trust-native` to pin reviewed native executable digests through a guarded, preview-first write:
  - an exact expected policy SHA-256;
  - validated digests for one platform;
  - every other field preserved;
  - the backup and the result read back.

## 0.10.43

- Accept ordinary email sign-in codes through bounded stdin and mask interactive code input. Preserve workspace enrollment and legacy sign-in options.
- Make the declared maintenance executable directly runnable and check every installed package binary's executable mode and Bun shebang during release verification.
- Request the established hosted CLI scope set when returning sign-in creates a profile key, including billing access. Preserve generic SDK key defaults, preissued keys and origin binding.
- Retain an independently inspectable, installed-consumer-verified archive from tagless release validation. Publication still requires the separately reviewed annotated release tag.

## 0.10.42

- Add explicit `codex-settings-v4` reviews and a preserved-preimage upgrade for native model-availability tooltip counters. Normal counter advances, unquoted model names and the first count in an empty TUI table preserve the witness; invalid literals and unrelated discovery controls remain guarded. Existing witness versions, configuration, root aliases and session pins retain their meanings and custody.

## 0.10.41

- Remove the Codex plugin cache allowance prepared for 0.10.40. The native skill guard again refuses skill copies under `~/.codex/plugins/cache/openai-curated-remote/` like any other unmanaged native copy, because skill payloads reach agents only through the Skills CLI, with no native fallback. A regression test keeps that tree refused and confirms no acceptance receipt is written.

## 0.10.40 (not published)

- Prepared an allowance for skills the Codex app materializes under `~/.codex/plugins/cache/openai-curated-remote/`. It was withdrawn before publication because it conflicted with the no-native-fallback boundary; 0.10.41 removes it.

## 0.10.39

- Compare installed Skills payload bytes separately from npm-created nested dependencies; reject bundled dependency payloads and retain complete runtime integrity, symlink and rollback checks.

## 0.10.38

- Retain denied remote skill identities and reviewed inactive Claude graphs when an entire retired cache materialization disappears, while still refusing active missing hooks and unsafe reappearance.
- Preserve planner-reviewed body-free remote version and whole disabled parent cleanup with exact source and directory inventories; keep active versions, receipts, direct hooks and unrelated membership guarded.
- Plan explicit reviewed denials for newly named omitted remote Codex skill materializations using fresh native installation and manifest evidence, preserving existing disables and transactional checks.

## 0.10.37

- Coordinate Skills writes to a shared Codex corpus through existing native admission and shared leases, retaining custody through rollback and child-process completion.
- Apply the same protection to alternate adapters, archive adoption and pruning, remote plugin refresh, and configuration updates; refuse unenrolled or conflicting corpus state before mutation.

## 0.10.36

- Plan an exact disabled path for a refreshed remote Codex plugin skill when the installed identity, current manifest and existing qualified-name deny are explicitly reviewed. Preserve previous denies and native trust controls.
- Refuse retained plugin reviews without a fresh native catalog when capabilities change, including during preview.

## 0.10.35

- Add a read-only SDK and stdin CLI projection for Skills-managed Claude hook commands in copied settings, preserving account metadata, local hooks and explicit empty overrides.
- Require canonical policy/discovery and exact package identity, including descriptor-bound macOS ACL checks, before returning replacements. Configuration owners still control preservation, writer leases and application.

## 0.10.34

- Allow exact-version runtime updates to require a minimum dependency release age and explicit package exclusions in isolated npm lock resolution and installation.
- Refuse unsupported npm capabilities, invalid policy inputs and policy flags on other update operations; preserve default isolation, runtime preimages and rollback.

## 0.10.33

- Resolve explicitly reviewed native root aliases before Sumi skill discovery checks, allowing Sumi-only integration when Claude and Codex roots use reviewed aliases.
- Preserve refusal of unreviewed, outside-home and nested skill symlinks.

## 0.10.32

- Publish fully initialized session write locks atomically after process identity checks, so interrupted hooks cannot leave new empty locks.
- Keep the writer descriptor open until release and bind interrupted hard-link publication recovery to the exact preserved inode and bytes. Historical empty or malformed locks still require review.

## 0.10.31

- Admit the exact bundled browser and computer-use MCP cleanup hook contracts for Codex 0.159.2 and 0.160.0 during qualified native skill review.
- Keep inline cleanup hooks in plugin fingerprints after skill bodies disappear; refuse unsupported handlers, arguments, external hook files and companion plugin MCP declarations.

## 0.10.30

- Add a separate Sumi native V2 plugin bridge that supplies selected Skills context to prompts without native Skill payload fallback.
- Bind native discovery to reviewed Sumi configuration and local plugins, including legacy plugin aliases; retain permissions and compatibility-root checks.
- Preserve root and child session selection custody using exact native parent session identity and generation checks.
- Isolate Sumi test configuration selectors from inherited station and CI environments.

## 0.10.28

- Tolerate Codex's typed root/profile personality preference changes in V3 settings reviews while preserving native instruction, discovery and provider controls.
- Keep existing V3 digests without personality unchanged; require explicit review for stored witnesses that included that field.

## 0.10.27

- Add explicitly reviewed Codex V3 settings witnesses that tolerate inference preferences and supported ordinary local stdio MCP upgrades without changing native discovery guards.
- Preserve V1/V2 witness meanings and require an exact preserved-preimage proof for V3 migration; retain reserved Apps, auth/cloud/HTTP, unknown and unsupported MCP contracts.
- Reuse the existing native local stdio metadata validator while preserving full plugin capability fingerprints.

## 0.10.26

- Keep attested Codex plugin installation inputs inert when reviewed discovery starts in a descendant skills directory; retain installed-cache and native-root checks.

## 0.10.25

- Keep positively attested, config-disabled Codex local plugin caches inert across version refreshes, without relaxing active hook or capability review.
- Distinguish witnessed native local installation inputs from installed skill-loading roots; retain complete migration inventory and strict identity, source and configuration guards.

## 0.10.24

- Review supported Codex local stdio MCP tool, approval, timeout and environment metadata while retaining exact capability fingerprints and refusal on remote, authentication, unknown or changed controls.

- Accept verified macOS system-root aliases in native skill inventory and migration while rejecting writable or ACL-replaceable roots, unsafe links, and changed identities.

## 0.10.23

- Preserve reviewed local stdio MCP declarations while denying plugin Skill names, with exact capability fingerprints and refusal on unsupported or changed declarations.

- Accept a validated native Codex catalog with no plugin-cache skill documents; retain refusals for cached identity mismatches and duplicate qualified names.

## 0.10.22

- Release the reviewed Codex compatibility and witness updates with canonical package file modes; 0.10.21 was not published after its archive linkage check refused the author pack.

## 0.10.21 (not published)

- Review already disabled remote plugin skills with missing native installed versions using the exact native remote ID and Codex install receipt; retain refusal for unsafe or ambiguous materializations.

### Patch Changes

- Qualify Codex 0.160.0 native hook dispatch and skill catalog/name-denial semantics through one shared compatibility registry; retain trust guards and refuse unmeasured versions.

- Preserve existing Codex v1 witnesses and add explicit v2 reviews plus exact-preimage guarded rebind for benign hook-trust, serialization and disabled-skill changes; retain discovery-change refusals.

## 0.10.20

### Patch Changes

- Review a Codex plugin skill omitted from native `skills/list` only when its exact path is already disabled and its cache version, manifest, and installed plugin identity agree; enroll the stable qualified name without changing the existing path rule.
- Deliver complete selected instructions through managed prompt hooks by default, including documents larger than the former 8,000-character limit; keep a character budget only when the caller explicitly requests one.

## 0.10.19

### Patch Changes

- Capture Codex 0.159.2 native skill identities through the package-owned CLI into an exclusive private catalog file for reviewed, update-safe hook enrollment.

## 0.10.18

### Patch Changes

- Adopt guarded one-hop npm and Homebrew Skills aliases that point through an owned package-root link to a verified older copyfile runtime. Preserve the intermediate link preimage and refuse chain drift, cycles and unsafe ancestors before switching or rollback.

## 0.10.17

### Patch Changes

- Add guarded adoption and receipt-backed rollback for legacy public Skills aliases outside the active copyfile launcher set, preserving exact link and binary preimages and refusing unsafe paths.

## 0.10.16

### Patch Changes

- Keep verified native prompts usable without Skill payload when owned context delivery is unavailable, while preserving strict load/run, session integrity and native authority controls.
- Add explicit preimage-checked Claude and Codex settings witness upgrades that permit typed preferences without relaxing native controls.
- Preserve native document-path disables and add reviewed qualified Codex plugin-name disables so known disabled identities survive versioned cache regeneration without native startup on prompts.

## 0.10.15

Normalize the installed `node_modules` root permissions during copyfile runtime updates, preventing group or other write access under permissive umasks.

## 0.10.11

Accept a Codex plugin cache's `latest` alias when its fully inventoried version contains only skills disabled by exact native configuration. A newly added or enabled native skill still fails closed.

## 0.10.10

Accept repeated directories in PATH when discovering copyfile runtime launchers, while retaining one guarded switch per distinct launcher. The npm release workflow also waits for the published version and provenance to become visible before completing its registry readback.

## 0.10.9

Add an exact-version, receipt-backed copyfile runtime update and rollback path for Skills CLI installations across Linux and macOS. The updater validates the npm archive and active launchers before switching, preserves configuration and launcher preimages, and records each recovery transition.

## 0.10.8

Accept native Codex hook trust enrollment with Codex CLI 0.157.0 and 0.157.1 after an isolated native app-server check. Unknown versions remain fail-closed.

## 0.10.7

This release prepares the hosted-first Skills CLI, MCP server, SDK and service for versioned skill publication, selection, synchronization and agent hooks. It adds package release checks that bind an independent review to the exact archive and verify npm provenance and registry integrity.

Earlier package history remains available in the published npm versions and their release records. Operational skill payloads and account catalogs are stored outside this software repository.
