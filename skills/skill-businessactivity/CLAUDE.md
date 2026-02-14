# CLAUDE.md

Claude-specific instructions for working with service-businessactivity.

## Project Overview

**service-businessactivity** is a CLI tool for managing business functions, activities, workflows, responsibilities, and ownership (humans or AI agents). It supports multi-profile configuration where each profile represents a different company/organization.

- **Type**: CLI service (no HTTP API)
- **Storage**: Local JSON files in `~/.service/service-businessactivity/`
- **Runtime**: Bun

## Architecture

### Multi-Profile System

- Profile config stored in `~/.service/service-businessactivity/config.json`
- Each profile has its own data directory: `~/.service/service-businessactivity/profiles/{profile-name}/`
- Commands operate on `currentProfile` unless `--profile` flag is used

### Data Structure

```
~/.service/service-businessactivity/
├── config.json                    # Multi-profile configuration
└── profiles/
    └── {profile-name}/
        ├── owners.json            # Humans or agents with capabilities
        ├── teams.json             # Team definitions
        ├── team-members.json      # Team membership (junction)
        ├── functions.json         # Hierarchical business functions
        ├── activities.json        # Activities under functions
        ├── workflows.json         # Workflow definitions
        ├── workflow-steps.json    # Ordered workflow steps
        └── responsibilities.json  # RACI assignments
```

### Command Structure

All commands follow the pattern: `service-businessactivity <resource> <action> [options]`

Resources:
- `profile` - Multi-tenant company management
- `owner` - Human and AI agent management
- `team` - Team management with membership
- `function` - Hierarchical business function management
- `activity` - Activity tracking under functions
- `workflow` - Multi-step workflow definition
- `responsibility` - RACI responsibility assignments

## Development Guidelines

### Adding New Commands

1. Create command file in `src/commands/<resource>.ts`
2. Export `register<Resource>Commands(program: Command)` function
3. Import and register in `bin/cli.ts`
4. Follow existing patterns for error handling and output

### Storage Operations

```typescript
import { requireProfile } from '../lib/config';
import { getOwnersPath } from '../lib/paths';
import { readArray, appendToArray, findById } from '../lib/storage';

// Get current profile
const { name: profileName } = await requireProfile();

// Get path to data file
const ownersPath = getOwnersPath(profileName);

// Read all items
const owners = await readArray<Owner>(ownersPath);

// Find by ID
const owner = await findById<Owner>(ownersPath, id);

// Add new item
await appendToArray(ownersPath, newOwner);

// Update item
await updateInArray<Owner>(ownersPath, id, { name: 'New Name' });

// Remove item
await removeFromArray<Owner>(ownersPath, id);
```

### Error Handling

- Use `error()` helper for user-facing errors
- Use `info()` for informational messages
- Use `success()` for confirmations
- Exit with code 1 on errors

### Output Formatting

- Use `printTable()` for tabular data
- Use `printTree()` for hierarchical data
- Truncate IDs with `.slice(0, 12) + '...'`
- Use `formatDate()` for timestamps

## Common Tasks

### Test CLI

```bash
# Show help
bun run dev --help

# Test profile commands
bun run dev profile list

# Test with specific profile
bun run dev owner list --profile "Test Corp"
```

### Install Globally

```bash
bun link
service-businessactivity --help
```

## Key Files

| File | Purpose |
|------|---------|
| `bin/cli.ts` | CLI entry point |
| `src/lib/paths.ts` | File path helpers |
| `src/lib/storage.ts` | JSON read/write utilities |
| `src/lib/config.ts` | Multi-profile configuration |
| `src/lib/output.ts` | CLI output helpers |
| `src/types/index.ts` | TypeScript type definitions |
| `src/commands/*.ts` | Command implementations |

## Conventions

- All entities have `createdAt` and `updatedAt` timestamps
- IDs are generated with prefix + random string (e.g., `own_abc123`, `wf_xyz789`)
- Metadata fields are optional JSON objects for flexibility
- IDs use prefixes: `prof_`, `own_`, `team_`, `func_`, `act_`, `wf_`, `step_`, `resp_`

## Testing Checklist

Before committing:
1. `service-businessactivity --help` shows all commands
2. Profile creation/listing works
3. Owner CRUD operations work
4. Team management with members works
5. Function hierarchy displays correctly
6. Activity status updates work
7. Workflow step ordering works
8. RACI matrix displays correctly

## Entity Types

### Owner Types
- `human` - Human team member
- `agent` - AI agent with capabilities

### Responsibility Types (RACI)
- `owner` - Responsible (does the work)
- `accountable` - Accountable (ultimate authority)
- `consulted` - Consulted (provides input)
- `informed` - Informed (kept in the loop)

### Workflow Trigger Types
- `manual` - Manually triggered
- `scheduled` - Time-based trigger
- `event` - Event-based trigger
- `condition` - Condition-based trigger

### Activity/Workflow Statuses
- `pending`, `in_progress`, `completed`, `cancelled`
- Workflows also: `draft`, `active`, `paused`, `archived`
