---
name: skill-e2bswarm
description: Spawn and manage E2B sandbox instances for parallel Claude Code task execution. Use when you need to run multiple tasks in parallel across isolated environments, distribute work across sandboxes, or execute tasks in clean environments.
disable-model-invocation: true
allowed-tools: Bash(bun:*), Bash(e2b:*), Read, Write
---

# E2B Swarm

Spawn E2B sandbox instances in parallel to execute Claude Code tasks across isolated environments.

## Installation

```bash
cd ~/.claude/skills/skill-e2bswarm && bun install
```

Or link from the repo:
```bash
ln -s ~/Workspace/dev/hasnaxyz/skill/skilldev/skill-e2bswarm ~/.claude/skills/skill-e2bswarm
```

## Commands

### Spawn instances with tasks

From a task list ID (loads from ~/.claude/tasks/<id>/):
```bash
skill-e2bswarm spawn \
  --repo <github-url> \
  --tasks <task-list-id> \
  --instances <count>
```

From a local folder containing task JSON files:
```bash
skill-e2bswarm spawn \
  --repo <github-url> \
  --tasks-dir ./my-tasks/ \
  --instances <count>
```

From inline JSON:
```bash
skill-e2bswarm spawn \
  --repo <github-url> \
  --tasks-json '[{"id":"1","subject":"Task 1","description":"Do something"}]' \
  --instances <count>
```

From a JSON file:
```bash
skill-e2bswarm spawn \
  --repo <github-url> \
  --tasks-file ./tasks.json \
  --instances <count>
```

### Check status
```bash
skill-e2bswarm status
skill-e2bswarm status --instance <id>
```

### Collect results
```bash
skill-e2bswarm collect --output ./results
```

### Kill instances
```bash
skill-e2bswarm kill              # Kill all
skill-e2bswarm kill --instance <id>  # Kill specific
```

## Options

| Option | Description |
|--------|-------------|
| `--repo, -r` | Git repository URL (required) |
| `--tasks, -t` | Task list ID from ~/.claude/tasks/ |
| `--tasks-dir` | Local folder containing task JSON files |
| `--tasks-file` | Path to a JSON file with tasks array |
| `--tasks-json` | Inline JSON array of tasks |
| `--instances, -n` | Number of parallel instances (default: 1) |
| `--prompt, -p` | Additional context/instructions for Claude |
| `--branch, -b` | Git branch to clone |
| `--distribute, -d` | Task distribution mode: all, round-robin, by-dependency |

## Task Distribution Modes

- **all**: Each instance receives all tasks (default)
- **round-robin**: Tasks distributed evenly across instances
- **by-dependency**: Tasks grouped by dependency chains

## Environment Variables

- `E2B_API_KEY`: Your E2B API key (required, add to ~/.secrets)

## Examples

Spawn 4 instances to work on videoben tasks in parallel:
```bash
skill-e2bswarm spawn \
  --repo git@github.com:hasnastudio/iapp-videoben.git \
  --tasks iapp-videoben-dev \
  --instances 4 \
  --distribute round-robin \
  --prompt "Complete all assigned tasks, run tests before marking complete"
```

Run tasks from a local JSON file:
```bash
skill-e2bswarm spawn \
  --repo git@github.com:org/repo.git \
  --tasks-file ./sprint-tasks.json \
  --instances 2
```
