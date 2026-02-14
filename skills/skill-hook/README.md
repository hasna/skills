# skill-hook

Claude Code hook scaffold generator. Creates complete hook templates with a single command.

## Installation

```bash
bun add -g git+ssh://git@github.com/example/skill-hook.git
```

## Usage

```bash
# Interactive - prompts for hook name
skill-hook

# Direct - creates hook-myname folder
skill-hook myname

# With options
skill-hook myname --event PostToolUse --matcher Bash
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--event` | Hook event type | PreToolUse |
| `--matcher` | Tool matcher pattern | * |
| `--output` | Output directory | . |

## Events

- **PreToolUse** - Before tool runs (can block)
- **PostToolUse** - After tool runs (observe only)
- **Stop** - When agent stops

## What's Generated

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
│   │   └── <name>.ts         # Hook logic (implement here)
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

## After Creating

1. `cd hook-<name>`
2. `bun install`
3. Edit `src/core/<name>.ts` - implement your logic
4. Test: `bun run src/index.ts test`
5. Push to GitHub
6. Install: `bun add -g git+ssh://git@github.com/example/hook-<name>.git`
7. Setup: `hook-<name> setup`

## License

MIT
