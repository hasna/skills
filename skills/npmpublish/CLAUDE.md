# npmpublish

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
- `SKILL.md` - bundled skill instructions served through Skills CLI/MCP

## Agent Integration

Do not copy or symlink this skill into agent-native skill folders. Register the
root Skills MCP server instead:

```bash
skills mcp --register all
```
