# npmpublish

Publish npm packages with sensible defaults:
- **Private by default** - Sets `publishConfig.access: restricted`
- **Patch bump by default** - Increments version by 0.0.1 (not 0.1.0)

Works as both a **Claude Code** skill and **OpenAI Codex** skill.

## Installation

```bash
# Install globally
bun add -g @hasnaxyz/npmpublish

# Or run directly
bunx @hasnaxyz/npmpublish
```

### Claude Code Skill

Link to Claude Code skills directory:
```bash
ln -s ~/Workspace/dev/hasnaxyz/skill/skilldev/npmpublish ~/.claude/skills/npmpublish
```

Or copy the SKILL.md:
```bash
mkdir -p ~/.claude/skills/npmpublish
cp SKILL.md ~/.claude/skills/npmpublish/
```

Then invoke with `/npmpublish` in Claude Code.

### OpenAI Codex Skill

Link to Codex skills directory:
```bash
ln -s ~/Workspace/dev/hasnaxyz/skill/skilldev/npmpublish ~/.codex/skills/npmpublish
```

Or for project-specific:
```bash
mkdir -p .codex/skills/npmpublish
cp SKILL.md .codex/skills/npmpublish/
```

Then invoke with `/npmpublish` in Codex.

## Usage

```bash
# Publish with defaults (private, patch bump)
npmpublish

# Specify bump type
npmpublish --bump minor    # 0.1.0 increment
npmpublish --bump major    # 1.0.0 increment
npmpublish --bump patch    # 0.0.1 increment (default)

# Publish as public (use carefully!)
npmpublish --public

# Dry run (see what would happen)
npmpublish --dry-run

# Publish from a different directory
npmpublish --dir /path/to/package
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --bump <type>` | Version bump: patch, minor, major | patch |
| `--public` | Publish as public package | false (private) |
| `--dry-run` | Preview without publishing | false |
| `-d, --dir <path>` | Package directory | current dir |

## Requirements

- `NPM_TOKEN` in `~/.secrets` for npm authentication
- Valid `package.json` in target directory
- Bun runtime

## What It Does

1. Reads `package.json`
2. Ensures `publishConfig.access: restricted` (unless --public)
3. Bumps version by specified amount (default: patch/0.0.1)
4. Updates `package.json`
5. Runs `bun publish`
6. Confirms private access on npm registry

## Why Private by Default?

Most internal tools, skills, and packages should be private. Making them public requires explicit intent with `--public`. This prevents accidental exposure of internal code.

## Why Patch Bump by Default?

Following semver, most publishes are bug fixes or small improvements (patch). Minor and major bumps should be intentional decisions, not defaults.

## License

MIT
