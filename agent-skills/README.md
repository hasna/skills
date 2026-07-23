# Agent Workflow Skills (fleet)

Canonical git source for Hasna **agent workflow skills** — instruction-first
skills that tell coding agents how to run fleet workflows: session login,
project creation, publishing, guarded merging, and so on.

These are deliberately **not** part of the public `skills/` corpus:

- `skills/` entries are executable skill packages with registry entries,
  validated by `src/lib/validation.test.ts` and guarded by
  `scripts/check_skill_corpus_drift.sh`. Agent workflow skills have no
  `package.json`/`src` and must not trip the corpus guard.
- This directory is not shipped in the npm package (`package.json#files`
  excludes it).

## Layout

```text
agent-skills/<skill-name>/
├── SKILL.md
├── scripts/       # optional deterministic helpers and focused tests
├── references/    # optional progressively disclosed safety detail
└── tests/         # optional raw, inert fixtures
```

Frontmatter follows the agent skill format (`name`, `description`). Older
workflow skills may retain Claude's `user_invocable` compatibility field. Keep
only resources required to make fragile behavior deterministic. The repository
copy is canonical.

## Distribution

Live copies run from each tool's skill directory (`~/.claude/skills`,
`~/.codex/skills`, `~/.config/opencode/skills`, `~/.cursor/skills`) on every
fleet machine. After a change merges here, distribution happens via
**skill-sync** (see `skill-sync` in the live skill set): Claude copy verbatim,
non-Claude copies with `user_invocable` stripped, all five machines.

Do not edit the live `~/.claude/skills` copies directly for these skills —
change them here, merge, then sync.
