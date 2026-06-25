# GOAL — Portable skill standard + scaffolding for open-skills (`@hasna/skills`)

Improve **open-skills** so anyone can **port and create skills under `~/.hasna/skills/`** with a clear
standard, **scaffold them via the CLI**, and have an agent build them out. Enter goal mode and do not
stop until it is implemented, tested, working, and published.

## What to build
1. **A portable SKILL STANDARD.** Document a clear spec for a skill that lives in its own subfolder
   `~/.hasna/skills/<skill-name>/`:
   - a **manifest** (`SKILL.md` with frontmatter and/or `skill.json`) declaring `name`, `description`,
     `version`, what it does, inputs/args, and the command(s) it exposes;
   - a defined **folder layout** (manifest + entrypoint/script + optional assets/tests);
   - compatible with the existing `skill-<name>` SKILL.md conventions already used in this workspace
     (read them first) — extend, don't break them.
2. **CLI scaffold command.** `skills new <name>` (a.k.a. `skills scaffold <name>`) creates a new
   standardized skill folder under `~/.hasna/skills/<name>/` from a template, **including an
   `AGENTS.md`** that tells a coding agent exactly how to build out that skill (its contract, where to
   put logic, how to test, how to expose it via the CLI). The flow: user runs `skills new my-skill`
   → gets a scaffolded folder + AGENTS.md → an agent picks it up and implements it.
3. **Use skills via the CLI.** Skills installed/ported into `~/.hasna/skills/` are discoverable and
   runnable: `skills list`, `skills show <name>`, `skills run <name> [args]`, `skills validate <name>`
   (checks a skill conforms to the standard).
4. **Porting.** Support importing/porting an existing skill folder into the standard
   (`skills port <path>` or `skills add <path>`), validating + normalizing it into `~/.hasna/skills/`.

## How
- Explore the **current open-skills repo** (CLI, MCP, SDK, package) and the existing **SKILL.md
  conventions** in this workspace before changing anything. Model structure/conventions on sibling
  `~/workspace/hasna/opensource/open-*` repos (e.g. open-todos) — keep **CLI ↔ MCP parity**.
- **TDD**: tests first, full suite green, nothing skipped. Secrets scan before every commit/push;
  conventional commits, no Co-Authored-By.
- **Publish** `@hasna/skills` (public, patch version bump) when done; `bun install -g @hasna/skills`
  and verify the new commands work.

## Done when (verified, not assumed)
- [ ] The skill standard is documented (docs/) and there's a working template.
- [ ] `skills new <name>` scaffolds `~/.hasna/skills/<name>/` with a valid manifest + `AGENTS.md`.
- [ ] `skills list` / `show` / `run` / `validate` work against `~/.hasna/skills/`.
- [ ] Porting an existing skill into the standard works and validates.
- [ ] `bun run build` clean, `bun test` green; published `@hasna/skills` (npm view shows new version) and installs/runs.
