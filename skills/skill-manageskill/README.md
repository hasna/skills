# service-{{name}}

{{description}}

A TypeScript service template with CLI, API client, and database integration.

## Features

- CLI tool for managing items
- HTTP server with REST API
- PostgreSQL database with migrations
- Configuration management
- Installer for Claude/Codex tools

## Installation

```bash
# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
```

## Configuration

### Environment Variables

Edit `.env` file with your configuration:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME={{name}}_db
DB_USER=postgres
DB_PASSWORD=postgres

# Server
PORT=3000

# API
API_URL=https://api.example.com
API_KEY=your-api-key-here
```

### CLI Configuration

Configure the CLI tool:

```bash
# Set API URL
bun cli config --set-api-url https://api.example.com

# Set API key
bun cli config --set-api-key your-api-key-here

# Show current configuration
bun cli config --show
```

## Database Setup

```bash
# Run migrations
bun run db:migrate

# Seed database
bun run db:seed

# Reset database (migrate + seed)
bun run db:reset
```

## Development

```bash
# Start server with auto-reload
bun run dev

# Start server
bun run start
```

## CLI Usage

### Setup

```bash
# Interactive setup
bun run cli setup
```

### Managing Items

```bash
# List all items
bun run cli list

# List with options
bun run cli list --filter "category" --limit 20

# Get item by ID
bun run cli get <item-id>

# Search items
bun run cli search "query" --limit 10

# Add item
bun run cli add --name "Item Name" --description "Description"

# Add item with metadata
bun run cli add --name "Item" --metadata '{"key": "value"}'
```

### Installation to Claude/Codex

```bash
# Install to both
bun run cli install <item-id>

# Install to specific target
bun run cli install <item-id> --target claude
bun run cli install <item-id> --target codex

# Install multiple items
bun run cli install <id1> <id2> <id3>

# Force overwrite
bun run cli install <item-id> --force

# Clear installed items
bun run cli install --clear

# List installed items
bun run cli install --list
```

## API Endpoints

The server provides the following REST API endpoints:

### Health Check

```bash
GET /health
```

Returns server health status.

### Items

```bash
# List items
GET /api/items

# Create item
POST /api/items
Content-Type: application/json

{
  "name": "Item name",
  "description": "Item description",
  "metadata": {"key": "value"}
}
```

## Project Structure

```
.
├── bin/
│   └── cli.ts              # CLI entry point
├── src/
│   ├── lib/
│   │   ├── api-client.ts   # API client functions
│   │   ├── config.ts       # Configuration management
│   │   └── installer.ts    # Claude/Codex installer
│   ├── db/
│   │   └── index.ts        # Database connection
│   └── server/
│       └── index.ts        # HTTP server
├── scripts/
│   ├── migrate.ts          # Database migrations
│   └── seed.ts             # Database seeding
├── .env.example            # Environment template
├── package.json            # Package configuration
├── tsconfig.json           # TypeScript config
└── README.md               # Documentation
```

## Scripts

- `bun run dev` - Start server with auto-reload
- `bun run start` - Start server
- `bun run cli` - Run CLI tool
- `bun run db:migrate` - Run migrations
- `bun run db:seed` - Seed database
- `bun run db:reset` - Reset database (migrate + seed)

## License

MIT

## Author

{{author}}