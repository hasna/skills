# service-consolelog

Monitor console logs from web applications using Playwright headless browser.

## Features

- **Console Log Capture**: Monitor all console message types (error, warn, info, log, debug)
- **Multi-App Support**: Track multiple applications and their pages
- **Headless Browser**: Uses Playwright for accurate browser-based monitoring
- **SQLite Storage**: Local database for configuration and log history
- **Watch Mode**: Continuous monitoring at configurable intervals
- **CLI & HTTP API**: Flexible interfaces for integration
- **Export**: Export logs to JSON or CSV formats

## Installation

```bash
# Install from npm (recommended)
npm install -g @hasnaxyz/service-consolelog
# or
bun add -g @hasnaxyz/service-consolelog

# Install from GitHub
bun add -g github:hasnaxyz/service-consolelog

# Or clone and link locally
git clone https://github.com/hasnaxyz/service-consolelog.git
cd service-consolelog
bun install
bun link
```

## Quick Start

```bash
# Initialize in your project (creates .service-consolelog/)
service-consolelog init

# Run database migration
service-consolelog db:migrate

# Add an app to monitor
service-consolelog app add --name "myapp" --port 3000 --url "http://localhost:3000"

# Add pages to monitor
service-consolelog page add --app "myapp" --path "/" --name "Home"
service-consolelog page add --app "myapp" --path "/dashboard" --name "Dashboard"

# Run a scan
service-consolelog scan --app "myapp"

# View errors
service-consolelog logs --app "myapp" --level error
```

## CLI Commands

### Project Setup

```bash
service-consolelog init          # Initialize in current project
service-consolelog uninit        # Remove from current project
service-consolelog status        # Check installation status
```

### App Management

```bash
service-consolelog app add --name <name> --port <port> --url <url> [--description <desc>]
service-consolelog app list [--active-only]
service-consolelog app get <id|name>
service-consolelog app update <id|name> [--name <name>] [--port <port>] [--url <url>] [--active <bool>]
service-consolelog app remove <id|name>
```

### Page Management

```bash
service-consolelog page add --app <app> --path <path> [--name <name>] [--wait-for <selector>] [--timeout <ms>]
service-consolelog page list --app <app> [--active-only]
service-consolelog page remove <id>
```

### Scanning

```bash
service-consolelog scan --app <app>             # Scan single app
service-consolelog scan --all                   # Scan all active apps
service-consolelog scan --app <app> --pages "/" # Scan specific pages
```

### Viewing Logs

```bash
service-consolelog logs --app <app>                        # View recent logs
service-consolelog logs --app <app> --level error          # Filter by level
service-consolelog logs --app <app> --since "2024-01-01"   # Filter by date
service-consolelog history --app <app> --limit 10          # View scan history
```

### Export

```bash
service-consolelog export --app <app> --output ./logs.json --format json
service-consolelog export --app <app> --output ./logs.csv --format csv
```

### Watch Mode

```bash
service-consolelog watch start --app <app> --interval 5   # Monitor every 5 minutes
service-consolelog watch stop --app <app>                 # Stop monitoring
service-consolelog watch status                           # Check watch status
```

### Configuration

```bash
service-consolelog config --show                     # Show current config
service-consolelog config --set-headless true        # Set headless mode
service-consolelog config --set-timeout 30000        # Set default timeout
service-consolelog config --set-db-path ./data/db.sqlite
```

### HTTP Server

```bash
service-consolelog server --port 3100   # Start API server
```

## HTTP API

Start the server:
```bash
service-consolelog server
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/apps` | List all apps |
| POST | `/api/apps` | Create app |
| GET | `/api/apps/:id` | Get app |
| PUT | `/api/apps/:id` | Update app |
| DELETE | `/api/apps/:id` | Delete app |
| GET | `/api/apps/:appId/pages` | List pages |
| POST | `/api/apps/:appId/pages` | Add page |
| DELETE | `/api/pages/:id` | Remove page |
| GET | `/api/scans` | List scans |
| POST | `/api/scans` | Trigger scan |
| GET | `/api/scans/:id` | Get scan with logs |
| GET | `/api/logs` | Query logs |
| GET | `/api/logs/export` | Export logs |
| POST | `/api/watch/start` | Start watching |
| POST | `/api/watch/stop` | Stop watching |
| GET | `/api/watch/status` | Watch status |

### Example API Calls

```bash
# Create an app
curl -X POST http://localhost:3100/api/apps \
  -H "Content-Type: application/json" \
  -d '{"name":"myapp","port":3000,"base_url":"http://localhost:3000"}'

# Add a page
curl -X POST http://localhost:3100/api/apps/1/pages \
  -H "Content-Type: application/json" \
  -d '{"path":"/","name":"Home"}'

# Trigger a scan
curl -X POST http://localhost:3100/api/scans \
  -H "Content-Type: application/json" \
  -d '{"appId":1}'

# Get error logs
curl "http://localhost:3100/api/logs?appId=1&level=error"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/consolelog.db` | SQLite database path |
| `HEADLESS` | `true` | Run browser headless |
| `DEFAULT_TIMEOUT` | `30000` | Page load timeout (ms) |
| `PORT` | `3100` | HTTP server port |
| `WATCH_INTERVAL` | `300000` | Watch interval (ms) |
| `LOG_LEVEL` | `info` | Log level |

## Project Files

When you run `service-consolelog init`, it creates:

```
.service-consolelog/
├── README.md              # Local documentation
└── service-consolelog.log # Activity log
```

Global configuration is stored at `~/.consolelog.json`.

## Development

```bash
# Install dependencies
bun install

# Run CLI in dev mode
bun run dev

# Run server in dev mode
bun run server:dev

# Build executable
bun run build

# Reset database
bun run db:reset
```

## Hook Integration

This service is designed to work with Claude Code hooks. A hook can:

1. Trigger scans after document writes or build completion
2. Query the API for recent errors
3. Inject console log results into agent context

Example hook workflow:
```
PostToolUse (Write) → service-consolelog scan → Return errors to agent
```

## License

MIT
