# Skill Corpus Migration And Conflict Policy

This policy covers duplicated, renamed, and conflicting skills in the public
`hasna/skills` corpus and in any hosted wrapper registry that consumes it.

## Current Audit Result

The current local `skills/` directory set has no local-only skill directories,
no upstream-only skill directories, no duplicated registry names, and no local
skill directories missing registry entries.

There is no conflicting second skill corpus in the open package.

## Guard Command

Run the corpus guard before public package work and before hosted registry
import work:

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

Hosted registries that mirror the corpus should preserve:

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
| Duplicate registry name | Two registry records use `read-pdf` | Block sync until one record is removed or renamed. |
| Directory without registry entry | `skills/x` exists but `SKILLS` lacks `x` | Add registry metadata or remove the directory. |
| Registry without directory | `SKILLS` contains `x` but `skills/x` is missing | Restore the directory or remove the registry record. |
| Local-only skill | A local branch has a skill not in the public base | Decide whether it is an open contribution or remove it from the public package. |
| Upstream-only skill | The base added a skill not present locally | Pull the base or document why it is excluded. |
| Rename | `pdf-read` becomes `read-pdf` | Keep a metadata alias and redirect pins/runs to canonical slug. |
| Incompatible format | Skill lacks supported docs/package/source shape | Block publish/import until validation passes. |

## Rename Migration Path

Renames must be explicit:

1. Add the new canonical skill slug.
2. Keep the old slug as a legacy alias.
3. Redirect pins from the old slug to the canonical slug.
4. Redirect runs from the old slug to the canonical slug while preserving audit
   records with the requested slug where a hosted registry exists.
5. Keep both slugs searchable for one release cycle.
6. Document the migration in release notes.
7. Remove the legacy alias only after usage has fallen to zero and a migration
   window has passed.

Do not silently delete a skill directory or registry entry to resolve a rename.

## Hosted Skills

Private hosted skills should not be placed in upstream `hasna/skills` unless
they are useful as open generic skills. A hosted registry should represent
private skills with source provenance such as `private-hosted`, owner,
visibility, moderation state, and execution profile.

Hosted skills can share the same validation pipeline as upstream skills, but
they must not be copied into the public package or downloaded locally with
source when they are paid or server-executed.

## Sync Rule

If a conflict is generic, fix it in the public package. If it is hosted-service
specific, keep it in the hosted registry layer with a different slug, explicit
provenance, and a documented reason.
