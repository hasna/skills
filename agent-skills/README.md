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

Frontmatter follows the Claude Code skill format (`name`, `description`,
`user_invocable`). The Claude copy is the source copy.

## Distribution

Live copies run from each tool's skill directory (`~/.claude/skills`,
`~/.codex/skills`, `~/.config/opencode/skills`, `~/.cursor/skills`) on every
fleet machine. After a change merges here, distribution happens via
**skill-sync** (see `skill-sync` in the live skill set): Claude copy verbatim,
non-Claude copies with `user_invocable` stripped, all five machines.

Do not edit the live `~/.claude/skills` copies directly for these skills —
change them here, merge, then sync.
