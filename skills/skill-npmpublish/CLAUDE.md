# skill-npmpublish

Publish npm packages with private access and patch version bumps by default.

## Quick Reference

```bash
# Default: private, patch bump (0.0.1)
bun run src/index.ts

# Options
--bump <patch|minor|major>  # Version bump type (default: patch)
--public                    # Publish as public (default: private)
--dry-run                   # Preview without publishing
--dir <path>                # Package directory
```

## Project Structure

- `src/index.ts` - CLI entry point
- `SKILL.md` - Claude Code / Codex skill definition

## Skill Installation

For Claude Code:
```bash
ln -s $(pwd) ~/.claude/skills/npmpublish
```

For Codex:
```bash
ln -s $(pwd) ~/.codex/skills/npmpublish
```
