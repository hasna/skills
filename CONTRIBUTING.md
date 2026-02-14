# Contributing

1. Fork the repository
2. Create a new skill in `skills/skill-{name}/`
3. Follow the existing skill patterns
4. Submit a pull request

## Skill Structure

Each skill follows a consistent structure:

```
skill-{name}/
├── src/
│   ├── commands/      # CLI commands
│   ├── lib/           # Core logic
│   ├── types/         # TypeScript types
│   └── utils/         # Utilities
├── CLAUDE.md          # Development guide
├── SKILL.md           # Skill definition
├── README.md          # Usage documentation
└── package.json
```

## Publishing

The npm auth token should be set via `.npmrc`:

```bash
cp .npmrc.example .npmrc
# Set NPM_TOKEN in your environment
```
