# service-businessactivity

Business activity, workflow, and ownership management service.

A CLI tool for managing business functions, activities, workflows, responsibilities, and ownership (humans or agents). Supports multi-profile for managing multiple companies.

## Features

- **Multi-Profile Support**: Manage multiple companies/organizations
- **Owner Management**: Track humans and AI agents with capabilities
- **Team Management**: Organize owners into teams
- **Function Hierarchy**: Define hierarchical business functions
- **Activities**: Track activities under functions
- **Workflows**: Define multi-step workflows with assigned owners/teams
- **RACI Responsibilities**: Assign responsibilities using RACI matrix

## Installation

```bash
# Install dependencies
bun install

# Install globally
bun link

# Verify installation
service-businessactivity --help
```

## Storage

All data is stored locally in JSON files at `~/.service/service-businessactivity/`:

```
~/.service/service-businessactivity/
├── config.json                    # Multi-profile configuration
└── profiles/
    └── {profile-name}/
        ├── owners.json
        ├── teams.json
        ├── team-members.json
        ├── functions.json
        ├── activities.json
        ├── workflows.json
        ├── workflow-steps.json
        └── responsibilities.json
```

## CLI Usage

### Profile Management

Profiles represent different companies/organizations.

```bash
# Create a profile
service-businessactivity profile create --name "Acme Corp" --description "Main company"

# List profiles
service-businessactivity profile list

# Switch active profile
service-businessactivity profile use "Acme Corp"

# Show current profile
service-businessactivity profile current

# Delete a profile
service-businessactivity profile delete "Acme Corp" --force
```

### Owner Management

Owners are humans or AI agents that can be assigned to activities and workflows.

```bash
# Create a human owner
service-businessactivity owner create --name "John Doe" --type human --email john@example.com --capabilities "approve,review"

# Create an AI agent owner
service-businessactivity owner create --name "Support Bot" --type agent --capabilities "respond,escalate"

# List owners
service-businessactivity owner list
service-businessactivity owner list --type agent

# Get owner details
service-businessactivity owner get <id>

# Update owner
service-businessactivity owner update <id> --capabilities "approve,review,execute"

# Delete owner
service-businessactivity owner delete <id> --force
```

### Team Management

Teams group owners together for collective assignment.

```bash
# Create a team
service-businessactivity team create --name "Engineering" --description "Engineering team"

# List teams
service-businessactivity team list

# Add member to team
service-businessactivity team add-member --team <teamId> --owner <ownerId> --role "Lead"

# Remove member from team
service-businessactivity team remove-member --team <teamId> --owner <ownerId>

# Get team details with members
service-businessactivity team get <id>

# Delete team
service-businessactivity team delete <id> --force
```

### Function Management

Business functions can be organized hierarchically.

```bash
# Create a root function
service-businessactivity function create --name "Finance"

# Create a child function
service-businessactivity function create --name "Accounts Payable" --parent <parentId>

# List functions (tree view)
service-businessactivity function list

# List functions (flat)
service-businessactivity function list --flat

# Get function details
service-businessactivity function get <id>

# Update function
service-businessactivity function update <id> --description "Updated description"

# Delete function
service-businessactivity function delete <id> --force
```

### Activity Management

Activities are tasks within business functions.

```bash
# Create an activity
service-businessactivity activity create --name "Invoice Processing" --function <functionId> --status pending

# List activities
service-businessactivity activity list
service-businessactivity activity list --function <functionId>
service-businessactivity activity list --status in_progress

# Update activity status
service-businessactivity activity update <id> --status completed

# Get activity details
service-businessactivity activity get <id>

# Delete activity
service-businessactivity activity delete <id> --force
```

Activity statuses: `pending`, `in_progress`, `completed`, `cancelled`

### Workflow Management

Workflows define multi-step processes with assigned owners or teams.

```bash
# Create a workflow
service-businessactivity workflow create --name "Approval Flow" --trigger manual --status draft

# Add steps to workflow
service-businessactivity workflow add-step --workflow <id> --name "Submit Request" --action "submit"
service-businessactivity workflow add-step --workflow <id> --name "Review" --owner <ownerId> --action "review"
service-businessactivity workflow add-step --workflow <id> --name "Approve" --team <teamId> --action "approve"

# Reorder steps
service-businessactivity workflow reorder --workflow <id> --step <stepId> --position 2

# Show workflow with steps
service-businessactivity workflow show <id>

# List workflows
service-businessactivity workflow list
service-businessactivity workflow list --status active

# Update workflow
service-businessactivity workflow update <id> --status active

# Delete workflow
service-businessactivity workflow delete <id> --force
```

Workflow statuses: `draft`, `active`, `paused`, `archived`
Trigger types: `manual`, `scheduled`, `event`, `condition`

### Responsibility Management (RACI)

Assign responsibilities using RACI (Responsible, Accountable, Consulted, Informed).

```bash
# Assign responsibility for a function
service-businessactivity responsibility assign --owner <ownerId> --function <functionId> --type owner

# Assign responsibility for an activity
service-businessactivity responsibility assign --owner <ownerId> --activity <activityId> --type accountable

# List responsibilities
service-businessactivity responsibility list
service-businessactivity responsibility list --owner <ownerId>
service-businessactivity responsibility list --function <functionId>

# Show RACI matrix for a function
service-businessactivity responsibility matrix --function <functionId>

# Revoke responsibility
service-businessactivity responsibility revoke <id> --force
```

Responsibility types: `owner` (R), `accountable` (A), `consulted` (C), `informed` (I)

## Project Structure

```
service-businessactivity/
├── bin/
│   └── cli.ts                    # CLI entry point
├── src/
│   ├── commands/
│   │   ├── profile.ts            # profile commands
│   │   ├── owner.ts              # owner commands
│   │   ├── team.ts               # team commands
│   │   ├── function.ts           # function commands
│   │   ├── activity.ts           # activity commands
│   │   ├── workflow.ts           # workflow commands
│   │   └── responsibility.ts     # responsibility commands
│   ├── lib/
│   │   ├── config.ts             # Multi-profile config
│   │   ├── paths.ts              # File path helpers
│   │   ├── storage.ts            # JSON storage utilities
│   │   └── output.ts             # CLI output helpers
│   └── types/
│       └── index.ts              # TypeScript types
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

## Configuration

Profile configurations are stored in `~/.service/service-businessactivity/config.json`:

```json
{
  "currentProfile": "acme-corp",
  "profiles": {
    "acme-corp": {
      "name": "Acme Corp",
      "description": "Main company",
      "createdAt": "2025-01-29T12:00:00.000Z"
    }
  }
}
```

## Scripts

- `bun run dev` - Run CLI in development
- `bun run build` - Build for distribution

## License

MIT

## Author

Hasna
