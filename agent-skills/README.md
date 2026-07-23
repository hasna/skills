# Agent Workflow Skills (fleet)

Canonical git source for Hasna **agent workflow skills** — instruction-only
skills (a single `SKILL.md`, no executable package) that tell coding agents how
to run fleet workflows: session login, project creation, publishing, and so on.

These are deliberately **not** part of the public `skills/` corpus:

- `skills/` entries are executable skill packages with registry entries,
  validated by `src/lib/validation.test.ts` and guarded by
  `scripts/check_skill_corpus_drift.sh`. Agent workflow skills have no
  `package.json`/`src` and must not trip the corpus guard.
- This directory is not shipped in the npm package (`package.json#files`
  excludes it).

## Layout

```
agent-skills/<skill-name>/SKILL.md
```

Tracked frontmatter uses the repository format (`name`, `description`,
`user_invocable`). Distribution adapters derive target-specific copies from
this tracked source.

## Distribution

Codewith is a supported distribution target. After a change merges, use the
tracked `agent-skills/fleet-skill-normalization/SKILL.md` workflow to derive
Codewith copies with exactly `name` and `description` frontmatter and normalize
only explicitly scoped Codewith skill directories from the exact merged commit.

Other tool adaptation and distribution is separate unless explicitly scoped.
Do not manually edit live copies as source: change the canonical file here,
merge it, then run the tracked workflow for the supported target.
