---
name: skill-npmpublish
description: Publish npm packages with sensible defaults. Automatically sets private access and bumps patch version (0.0.1). Use when publishing packages to npm, especially for internal/private packages.
---

# npm Publish

Publish npm packages to the npm registry with sensible defaults:
- **Private by default** - Sets `publishConfig.access: restricted`
- **Patch bump by default** - Increments version by 0.0.1

## Usage

```bash
# Publish with defaults (private, patch bump)
skill-npmpublish

# Specify bump type
skill-npmpublish --bump minor    # 0.1.0
skill-npmpublish --bump major    # 1.0.0
skill-npmpublish --bump patch    # 0.0.1 (default)

# Publish as public (use carefully!)
skill-npmpublish --public

# Dry run (see what would happen)
skill-npmpublish --dry-run

# Publish from a different directory
skill-npmpublish --dir /path/to/package
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --bump <type>` | Version bump: patch, minor, major | patch |
| `--public` | Publish as public package | false (private) |
| `--dry-run` | Preview without publishing | false |
| `-d, --dir <path>` | Package directory | current dir |

## Requirements

- `NPM_TOKEN` in `~/.secrets` for authentication
- Valid `package.json` in target directory

## What It Does

1. Reads `package.json`
2. Ensures `publishConfig.access: restricted` (unless --public)
3. Bumps version by specified amount (default: patch/0.0.1)
4. Updates `package.json`
5. Runs `bun publish`
6. Confirms private access on npm registry

## Examples

```bash
# Standard publish for internal package
skill-npmpublish

# Release new feature version
skill-npmpublish --bump minor

# Breaking change release
skill-npmpublish --bump major

# Check what would be published
skill-npmpublish --dry-run
```
