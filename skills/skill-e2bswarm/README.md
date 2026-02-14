# skill-e2bswarm

Spawn E2B sandbox instances for parallel Claude Code task execution.

## Overview

This skill allows you to spawn multiple E2B sandboxes in parallel, each running Claude Code with a subset of tasks. This enables massively parallel task execution across isolated environments.

## Installation

```bash
# Clone and install
cd ~/Workspace/dev/hasnaxyz/skill/skilldev/skill-e2bswarm
bun install

# Link to Claude Code skills
bun run link
# or manually:
ln -sf $(pwd) ~/.claude/skills/skill-e2bswarm
```

## Configuration

Add your E2B API key to `~/.secrets`:

```bash
export E2B_API_KEY="your-api-key-here"
```

Get your API key at: https://e2b.dev/dashboard

## Usage

### As a Claude Code Skill

Once linked, you can invoke the skill directly:

```
/skill-e2bswarm spawn --repo git@github.com:org/repo.git --tasks my-task-list --instances 4
```

### As a CLI

```bash
# Spawn instances with tasks from Claude Code task list
bun run src/index.ts spawn \
  --repo git@github.com:org/repo.git \
  --tasks iapp-videoben-dev \
  --instances 4 \
  --distribute round-robin

# From a JSON file
bun run src/index.ts spawn \
  --repo git@github.com:org/repo.git \
  --tasks-file ./my-tasks.json \
  --instances 2

# From a directory of task files
bun run src/index.ts spawn \
  --repo git@github.com:org/repo.git \
  --tasks-dir ./tasks/ \
  --instances 3

# Inline JSON
bun run src/index.ts spawn \
  --repo git@github.com:org/repo.git \
  --tasks-json '[{"id":"1","subject":"Do something","description":"Details..."}]' \
  --instances 1

# Check status
bun run src/index.ts status

# Collect results
bun run src/index.ts collect --output ./results

# Kill all instances
bun run src/index.ts kill

# Clean up old instances
bun run src/index.ts clean
```

## Task Distribution Modes

| Mode | Description |
|------|-------------|
| `all` | Each instance receives all tasks (default) |
| `round-robin` | Tasks distributed evenly across instances |
| `by-dependency` | Tasks grouped by dependency chains |

## Task Format

Tasks follow the Claude Code task format:

```json
{
  "id": "1",
  "subject": "Brief task title",
  "description": "Detailed description with acceptance criteria",
  "activeForm": "Present tense action (e.g., 'Creating tests')",
  "status": "pending",
  "blocks": ["2", "3"],
  "blockedBy": []
}
```

See `examples/tasks-example.json` for a complete example.

## How It Works

1. **Spawn**: Creates E2B sandboxes, clones the repo, writes tasks, and starts Claude Code
2. **Execute**: Each sandbox runs Claude Code with its assigned tasks
3. **Collect**: Gathers results, updated tasks, and outputs from all sandboxes
4. **Clean**: Removes old sandbox state

## State Management

Instance state is persisted to `~/.claude/skill-e2bswarm-state.json` between commands.

## Development

```bash
# Watch mode
bun run dev

# Type check
bun run typecheck

# Build
bun run build
```

## License

MIT
