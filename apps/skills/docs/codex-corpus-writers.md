# Codex corpus writes

Writes inside a Codex home require its existing native corpus admission lock and a native executable supporting `corpus-admission-inspect --home <canonical-home>`, except under the interim fallback for upstream builds described below. The executable must return the admitted root and lock identities with state `committed-v1` or `committed-v2`. A version string alone does not establish this capability: a release admitted by the native compatibility registry, such as upstream Codex 0.160.1, still refuses here until its executable implements this inspection and native enrollment has created the admission.

The writer holds a shared `@hasna/contracts/kernel-lock` descriptor through preimage checks, preservation, writes, rollback and verification. Publication needs the corresponding exclusive descriptor. Missing locks, unenrolled or pending native state, changed identities and unavailable native inspection refuse the transaction. These clients never bootstrap enrollment or unlink the native lock.

The native executable defaults to `codex` on the caller's selected PATH; SDK write options also accept `codexCommand` and, where available, `codexSha256`. Existing native configuration operations retain their hash and version gates. Select the reviewed executable and corpus home together. This integration does not establish that an older CLI, Dock application or daemon participates.

Read-only previews do not authorize a later mutation. Ordinary non-Codex targets remain usable. Instructions' explicit Codex project renderer (`codexProject`) also remains usable for project `AGENTS.md` outside the native corpus.

Codex also discovers home and project `.agents/skills` directly. Native migration inventory binds these inputs to the selected `CODEX_HOME`, or the inventoried home's `.codex` when unset. Archival holds that home's admission too; an external discovery path is not an exemption. Protected paths keep their own lock even if an inventory entry carries another agent label.

## Interim fallback for upstream Codex builds

Upstream Codex 0.160.0 and 0.162.1 have no `corpus-admission-inspect` subcommand and never create the native lock. For builds that demonstrably lack the subcommand, and only for them, the writer replaces native admission verification with a bounded fallback. It applies only when all of these hold for every Codex home in the transaction:

- Neither the native lock path `<home>/.native-corpus-admission.flock-v1` nor the legacy `<home>/.native-corpus-admission.lock` exists. Any existing entry, of any type, keeps the native route, which refuses a legacy entry.
- The selected executable passes the same identity checks as the native route: absolute or found on PATH, resolved real path, regular file, executable, not group- or world-writable, owned by the user or root, and the optional `codexSha256` binding.
- `codex help corpus-admission-inspect` exits 2, prints nothing on standard output, and its standard error begins with the line `error: unrecognized subcommand 'corpus-admission-inspect'`.
- The control `codex help exec` exits 0.
- `codex --version` prints exactly `codex-cli <major>.<minor>.<patch>`, optionally with a semver prerelease suffix.

The probes run with standard input closed, a 5-second limit and a 4 KiB output bound. Only the `help` form is used: upstream Codex treats an unknown leading word as a prompt. Every other outcome refuses, including a help probe that exits 0 (the build has the subcommand, so the native route is required), a timeout, a signal, unexpected text, a failed control and an unrecognised version. An executable that changes while it is probed refuses with `executable-unverified`. A transaction that mixes homes with and without the native lock also refuses.

On every launch, including `help` and `--version`, upstream Codex creates helper aliases under `$CODEX_HOME/tmp/arg0`. The probes therefore run with a minimal environment: `PATH` and `HOME` are kept, and `CODEX_HOME` is a private, Skills-owned probe home. Under a temporary directory upstream refuses to create the aliases and prints a warning before the probe text, so a Codex home whose parent is under `/tmp` refuses with `probe-inconclusive`.

Skills state for the fallback lives beside the Codex home's physical location, not under a data-root override (`HASNA_SKILLS_DIR`, `HASNA_SKILLS_HOME`, `SKILLS_HOME` or `HASNA_DATA_HOME`), so every Skills writer on the same Codex home uses the same lock:

- lock: `<realpath(dirname(codex home))>/.hasna/skills/codex-corpus-locks/codex-corpus-<sha256 of the home's real path, device and inode>.flock-v1`
- probe home: `<realpath(dirname(codex home))>/.hasna/skills/codex-probe-home`

For a real `~/.codex` both are inside the default Skills data root. Before creating either, the writer checks that each existing component from the parent down is a directory owned by the user or root and is not group- or world-writable, that the location is not inside any Codex home (including through an alias) and that it is not under any home in the transaction. Otherwise it creates nothing there and refuses with `skills-lock-unavailable`. New components are created with mode 0700.

The writer holds an exclusive `@hasna/contracts/kernel-lock` on that file instead of the native shared lock, and creates, changes and removes nothing under the Codex home. Contention refuses after one bounded attempt. An alias and its physical home in one transaction share one descriptor, and both paths are rechecked. A native client opened inside the same Skills transaction, such as trust enrolment's own app-server connection, shares that transaction's descriptor, and the descriptor stays held until that client's child process has closed, even when its close is unconfirmed. Wherever the native route rechecks its lease during a write, the fallback re-verifies the Skills lock, the home's real path and identity, the continued absence of both native lock entries, and the executable identity. Preimage, rollback and readback checks are unchanged. A failed recheck, for example a native lock appearing mid-write, also refuses the rollback before it writes, as on the native route. Partial writes then stay in place and their preimage backups are retained for recovery.

This guarantee is weaker than native admission:

- Upstream Codex's own refresh writes are not coordinated with the Skills lock.
- Only Skills writers are mutually excluded.
- The existing preimage and readback checks refuse the races they detect; they cannot detect every concurrent native write.

Every receipt or JSON result produced by a fallback write records `nativeAdmission: "unavailable"` and a `nativeAdmissionProbe` with the selected executable's real path, SHA-256 and size, the validated `--version` string, the probe kind and the exit codes. The path, digest and size identify the selected executable file: for an npm install that is the launcher script, not the vendor binary it starts. Native output is never recorded. Trust enrolment also records it in its journal's `intent.json`, `stopped.json` and `receipt.json`. `removeSkillForAgent` and `removeManagedAgentSkill` return only a boolean; they use the fallback only when the caller passes `onCodexAdmission`, which receives the record before anything is removed, and otherwise refuse as before. Receipts from the native route are unchanged. Refusals keep the `CODEX_CORPUS_ADMISSION_REQUIRED` code and may add one fixed reason: `native-lock-present`, `executable-unverified`, `probe-inconclusive`, `command-present`, `writer-busy`, `skills-lock-unavailable` or `lease-changed`.

The fallback is interim. It is retired in the first Skills release after the Harnesses enrollment/inspect route is live for that Codex build line.

Contracts is a runtime dependency. Keep `@hasna/contracts/kernel-lock` external in the CLI and server bundles so the package resolves its descriptor-bound native helper from the installed Contracts package. SDK and MCP bundles include the unchanged owning lock implementation. The build verifies the exact pinned Darwin helper and stages independent copies at `native/kernel-lock-acl-darwin` and `dist/native/kernel-lock-acl-darwin`, matching the literal module-relative lookup. Both paths are included in the npm package; runtime integrity checks remain enabled.

Shared discovery is classified by its native input path, independently of the selected adapter. For example, `migrate native --agent sumi` still requires the selected/home Codex admission when it archives `.agents/skills`. An external shared input without its inventoried Codex home fails closed; unrelated `.sumi/skills` and `.agents/skill` inputs do not acquire a Codex lease.
