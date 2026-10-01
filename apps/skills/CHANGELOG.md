# Changelog

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
