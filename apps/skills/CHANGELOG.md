# Changelog

## Unreleased

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
