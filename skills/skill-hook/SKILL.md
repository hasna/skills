---
name: skill-hook
description: Create Claude Code hooks with standardized structure. Generates complete hook scaffolds with setup commands, logging, and Claude config integration. Just run `skill-hook` to create a new hook template.
---

# Hook Creation Skill

Creates Claude Code hook scaffolds following a standardized pattern. Run `skill-hook` in any directory to generate a complete hook project.

## Quick Start

```bash
# Install globally
bun add -g git+ssh://git@github.com/example/skill-hook.git

# Create a hook (interactive)
skill-hook

# Or with a name directly
skill-hook my-hook
```

## What Gets Created

Running `skill-hook <name>` creates:

```
hook-<name>/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── run.ts            # Main hook logic
│   │   ├── setup.ts          # Setup command
│   │   ├── test.ts           # Manual testing
│   │   └── config.ts         # Configuration management
│   ├── core/
│   │   └── <name>.ts         # Hook-specific logic (implement here)
│   └── utils/
│       ├── logger.ts         # Configurable logging
│       └── claude.ts         # Claude config helpers
├── hook.config.json          # Self-describing metadata
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
└── HOOK.md
```

## Usage

```bash
skill-hook [name] [options]

Options:
  --event <event>     PreToolUse, PostToolUse, or Stop (default: PreToolUse)
  --matcher <match>   Tool matcher: Bash, Write, Edit, * (default: *)
  --output <dir>      Output directory (default: current)
  --help              Show help
```

## Hook Events

| Event | When | Can Block |
|-------|------|-----------|
| PreToolUse | Before tool executes | Yes |
| PostToolUse | After tool executes | No |
| Stop | When agent stops | No |

## After Creating

1. `cd hook-<name>`
2. `bun install`
3. Edit `src/core/<name>.ts` - implement your logic
4. Test: `bun run src/index.ts test`
5. Push to GitHub
6. Install: `bun add -g git+ssh://git@github.com/example/hook-<name>.git`
7. Setup: `hook-<name> setup`

## Hook Output Format

```typescript
{ "decision": "allow" }                           // Allow operation
{ "decision": "block", "reason": "Why blocked" }  // Block (PreToolUse only)
{ "decision": "error", "message": "Error msg" }   // Error occurred
```
