# skill-codefix

## Description

Code quality skill that provides auto-linting, formatting, and code fixes through a unified CLI interface. Wraps existing tools like ESLint, Prettier, Ruff, gofmt, etc.

## Category

Development Tools / Code Quality

## Commands

### fix
Fix code issues in file(s) or directory.

```bash
bun run src/index.ts fix <path> [options]
```

Options:
- `--type <lint|format|types|all>` - Type of fix (default: all)
- `--write` - Write fixes to files
- `--diff` - Show diff of changes
- `--ignore <patterns>` - Patterns to ignore

### analyze / check
Analyze code without making changes.

```bash
bun run src/index.ts analyze <path> [options]
```

Options:
- `--format <text|json|github>` - Output format
- `--errors-only` - Show only errors
- `--ignore <patterns>` - Patterns to ignore

### tools
Check available tools for a language.

```bash
bun run src/index.ts tools <language>
```

### languages
List supported file extensions.

```bash
bun run src/index.ts languages
```

## Dependencies

External tools (install separately):
- TypeScript/JavaScript: eslint, prettier, typescript
- Python: ruff, mypy
- Go: golangci-lint, gofmt
- CSS: stylelint
- Shell: shellcheck, shfmt

## Integration

### Use Cases

1. **CI Pipeline**: Run analysis in GitHub Actions with `--format github`
2. **Pre-commit Hook**: Auto-fix files before commit
3. **Manual Fix**: Fix specific files or directories on demand
4. **Code Review**: Analyze and report issues in text/JSON format

### Example: CI Check

```yaml
- name: Code Quality
  run: bun run src/index.ts check ./src --format github
```

### Example: Pre-commit

```bash
bun run src/index.ts fix ./src --write && git add -u
```

## Supported Languages

- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx)
- Python (.py)
- Go (.go)
- JSON (.json)
- YAML (.yaml, .yml)
- Markdown (.md)
- CSS/SCSS (.css, .scss)
- Shell (.sh, .bash)
- SQL (.sql)
