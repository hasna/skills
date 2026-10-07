# Codex corpus writes

Writes inside a Codex home require its existing native corpus admission lock and a native executable supporting `corpus-admission-inspect --home <canonical-home>`. The executable must return the admitted root and lock identities with state `committed-v1` or `committed-v2`. A version string alone does not establish this capability: a release admitted by the native compatibility registry, such as upstream Codex 0.160.1, still refuses here until its executable implements this inspection and native enrollment has created the admission.

The writer holds a shared `@hasna/contracts/kernel-lock` descriptor through preimage checks, preservation, writes, rollback and verification. Publication needs the corresponding exclusive descriptor. Missing locks, unenrolled or pending native state, changed identities and unavailable native inspection refuse the transaction. These clients never bootstrap enrollment or unlink the native lock.

The native executable defaults to `codex` on the caller's selected PATH; SDK write options also accept `codexCommand` and, where available, `codexSha256`. Existing native configuration operations retain their hash and version gates. Select the reviewed executable and corpus home together. This integration does not establish that an older CLI, Dock application or daemon participates.

Read-only previews do not authorize a later mutation. Ordinary non-Codex targets remain usable. Instructions' explicit Codex project renderer (`codexProject`) also remains usable for project `AGENTS.md` outside the native corpus.

Codex also discovers home and project `.agents/skills` directly. Native migration inventory binds these inputs to the selected `CODEX_HOME`, or the inventoried home's `.codex` when unset. Archival holds that home's admission too; an external discovery path is not an exemption. Protected paths keep their own lock even if an inventory entry carries another agent label.

Contracts is a runtime dependency. Keep `@hasna/contracts/kernel-lock` external when bundling so the package resolves its descriptor-bound native helper from its own installed assets.

Shared discovery is classified by its native input path, independently of the selected adapter. For example, `migrate native --agent sumi` still requires the selected/home Codex admission when it archives `.agents/skills`. An external shared input without its inventoried Codex home fails closed; unrelated `.sumi/skills` and `.agents/skill` inputs do not acquire a Codex lease.
