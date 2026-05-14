# Skill Corpus Migration And Conflict Policy

This policy covers duplicated, renamed, and conflicting skills between the
private `hasnatools/platform-skills` repo and upstream `hasna/skills`.

## Current Audit Result

The current local `skills/` directory set matches `upstream/main`. There are no
local-only skill directories, no upstream-only skill directories, no duplicated
registry names, and no local skill directories missing registry entries.

The current divergence from upstream is metadata/documentation level work, not
a conflicting second skill corpus. At the time this policy was added, the
tracked drift against `upstream/main` was limited to several `SKILL.md` files
and `src/lib/registry.ts`.

## Guard Command

Run the corpus guard before upstream sync work and before SaaS registry import
work:

```bash
scripts/check_skill_corpus_drift.sh --base upstream/main
```

For local self-checks and CI that may not have the upstream remote fetched:

```bash
scripts/check_skill_corpus_drift.sh --base HEAD
```

The guard compares:

- Local `skills/*` directories.
- Base ref `skills/*` directories.
- `SKILLS` registry names.
- Registry duplicates.
- Registry entries without directories.
- Directories without registry entries.

## Canonical Identity

The canonical skill slug is the bare directory name.
For example, `skills/read-pdf` maps to slug `read-pdf`.

The SaaS database should store:

- Canonical slug.
- Display name.
- Source package and version.
- Source git commit or npm version.
- Directory path.
- Optional legacy slugs.
- Optional replacement slug.

## Conflict Types

| Conflict | Example | Resolution |
| --- | --- | --- |
| Duplicate registry name | Two registry records use `read-pdf` | Block the sync until one record is removed or renamed. |
| Directory without registry entry | `skills/x` exists but `SKILLS` lacks `x` | Add registry metadata or remove the directory. |
| Registry without directory | `SKILLS` contains `x` but `skills/x` is missing | Restore the directory or remove the registry record. |
| Local-only skill | Private repo has a skill not in upstream | Decide whether it is private SaaS-only or an upstream contribution. |
| Upstream-only skill | Upstream added a skill not present locally | Pull upstream or document why it is excluded. |
| Rename | `pdf-read` becomes `read-pdf` | Keep a metadata alias and redirect pins/runs to canonical slug. |
| Incompatible format | Skill lacks supported docs/package/source shape | Block publish/import until validation passes. |

## Rename Migration Path

Renames must be explicit:

1. Add the new canonical skill slug.
2. Keep the old slug as a legacy alias in SaaS state.
3. Redirect pins from the old slug to the canonical slug.
4. Redirect runs from the old slug to the canonical slug while preserving audit
   records with the requested slug.
5. Keep both slugs searchable for one release cycle.
6. Document the migration in release notes.
7. Remove the legacy alias only after usage has fallen to zero and a migration
   window has passed.

Do not silently delete a skill directory or registry entry to resolve a rename.

## Private SaaS Skills

Private hosted skills should not be placed in upstream `hasna/skills` unless
they are useful as open generic skills. The SaaS registry should represent
private skills with source provenance such as `private-hosted`, tenant/team
ownership, visibility, moderation state, and execution profile.

Private skills can share the same validation pipeline as upstream skills, but
they must not be copied into the public package or downloaded locally with
source when they are paid or server-executed.

## Upstream Sync Rule

If a conflict is generic, fix it upstream. If it is SaaS-specific, keep it in
the private registry layer. Do not fork a public skill into a private duplicate
unless the private version has a different slug, explicit provenance, and a
documented reason.
