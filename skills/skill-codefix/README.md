# skill-codefix

Code quality CLI for auto-linting, formatting, and fixing code issues. Runs existing code tools (ESLint, Prettier, Ruff, gofmt, etc.) through a unified interface.

## Features

- **Unified Interface**: Single CLI for all code quality tools
- **Multi-Language**: TypeScript, JavaScript, Python, Go, JSON, YAML, Markdown, CSS
- **Auto-Detection**: Automatically detects language from file extension
- **Batch Processing**: Process entire directories with parallel execution
- **Multiple Fix Types**: Lint, format, type check, or all at once
- **Flexible Output**: Text, JSON, or GitHub Actions annotation format
- **Dry Run Mode**: Preview changes before applying

## Installation

```bash
cd skill-codefix
bun install
```

## Prerequisites

This skill wraps existing code quality tools. Install the tools you need:

### TypeScript/JavaScript
```bash
npm install -g eslint prettier typescript
```

### Python
```bash
pip install ruff mypy
```

### Go
```bash
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

### CSS
```bash
npm install -g stylelint
```

### Shell
```bash
# macOS
brew install shellcheck shfmt

# Linux
apt install shellcheck shfmt
```

## Usage

### Fix Command

Fix code issues in files or directories:

```bash
# Analyze without writing (default)
bun run src/index.ts fix src/index.ts

# Fix and write changes
bun run src/index.ts fix src/ --write

# Fix only formatting
bun run src/index.ts fix script.py --type format --write

# Show diff of changes
bun run src/index.ts fix src/app.ts --type lint --diff

# Ignore test files
bun run src/index.ts fix ./src --write --ignore "*.test.ts" "*.spec.ts"
```

### Analyze Command

Analyze code without making changes:

```bash
# Basic analysis
bun run src/index.ts analyze src/index.ts

# Analyze directory
bun run src/index.ts analyze ./src

# JSON output
bun run src/index.ts analyze ./src --format json

# GitHub Actions format
bun run src/index.ts check ./src --format github

# Show only errors
bun run src/index.ts analyze ./src --errors-only
```

### Tools Command

Check which tools are available:

```bash
# Check TypeScript tools
bun run src/index.ts tools typescript

# Check Python tools
bun run src/index.ts tools python

# Check Go tools
bun run src/index.ts tools go
```

### Languages Command

List supported file extensions:

```bash
bun run src/index.ts languages
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `fix` | Fix code issues in file(s) |
| `analyze` | Analyze code without making changes |
| `check` | Alias for analyze |
| `tools` | Show available tools for a language |
| `languages` | Show supported languages |
| `help` | Show help information |

## Options Reference

### Fix Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Fix type: lint, format, types, imports, all (default: all) |
| `--language <lang>` | Force language detection |
| `--write, -w` | Write fixes to files |
| `--dry-run` | Show what would be fixed |
| `--diff, -d` | Show diff of changes |
| `--output <path>` | Write output to different path |
| `--ignore <patterns>` | Patterns to ignore (glob) |
| `--parallel <n>` | Number of parallel workers (default: 4) |
| `--verbose, -v` | Verbose output |

### Analyze Options

| Option | Description |
|--------|-------------|
| `--type <type>` | Check type: lint, format, types, all |
| `--format <fmt>` | Output: text, json, github |
| `--errors-only` | Show only errors |
| `--ignore <patterns>` | Patterns to ignore |
| `--parallel <n>` | Parallel workers |

## Fix Types

| Type | Description |
|------|-------------|
| `lint` | Fix linting issues (ESLint, Ruff, golangci-lint) |
| `format` | Format code (Prettier, gofmt, ruff format) |
| `types` | Check type errors (TypeScript only) |
| `imports` | Organize imports |
| `all` | Run all applicable fixes |

## Supported Languages

| Language | Lint | Format | Type Check |
|----------|------|--------|------------|
| TypeScript | ESLint | Prettier | tsc |
| JavaScript | ESLint | Prettier | - |
| Python | Ruff | Ruff | mypy |
| Go | golangci-lint | gofmt | - |
| JSON | - | Prettier | - |
| YAML | - | Prettier | - |
| Markdown | - | Prettier | - |
| CSS/SCSS | Stylelint | Prettier | - |
| Shell | ShellCheck | shfmt | - |
| SQL | - | sql-formatter | - |

## CI Integration

### GitHub Actions

```yaml
- name: Check code quality
  run: |
    bun run src/index.ts check ./src --format github
```

The `--format github` option outputs annotations that GitHub displays inline in PRs.

### Pre-commit Hook

```bash
#!/bin/sh
bun run src/index.ts fix ./src --write
git add -u
```

## Examples

### Fix All TypeScript Issues

```bash
bun run src/index.ts fix ./src --write --type all
```

### Format Python Files

```bash
bun run src/index.ts fix ./scripts --write --type format
```

### Lint Check for CI

```bash
bun run src/index.ts check ./src --errors-only
```

### Process Specific Files

```bash
bun run src/index.ts fix src/utils.ts src/helpers.ts --write
```

## License

MIT
