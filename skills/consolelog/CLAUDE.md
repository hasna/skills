# CLAUDE.md

Claude-specific instructions for working with this codebase.

## Project Type

This is a Bun-based service that monitors console logs from web applications using Playwright headless browser. It provides both CLI and HTTP API interfaces.

## Quick Reference

| Command | Description |
|---------|-------------|
| `bun run start` | Run CLI |
| `bun run dev` | Dev mode with watch |
| `bun run server` | Start HTTP API |
| `bun run db:migrate` | Create tables |
| `bun run db:reset` | Reset database |
| `bun run build` | Build executable |

## Key Files

| File | Purpose |
|------|---------|
| `bin/cli.ts` | CLI entry point with all commands |
| `src/db/queries.ts` | Database CRUD operations |
| `src/lib/monitor.ts` | Playwright console monitoring |
| `src/lib/watcher.ts` | Watch mode implementation |
| `src/server/index.ts` | HTTP API server |

## Architecture Guidelines

### DO:
- Use `bun:sqlite` for database operations (built-in, no dependency)
- Use Bun.serve() for HTTP server
- Use Commander.js for CLI commands
- Use Playwright for browser automation
- Handle errors gracefully with try-catch
- Use prepared statements for SQL queries
- Log activity to `.service-consolelog/service-consolelog.log`

### DON'T:
- Don't use ORMs (raw SQL via bun:sqlite)
- Don't add Express/Fastify (use Bun.serve)
- Don't store secrets in code
- Don't break existing CLI command patterns
- Don't introduce external database dependencies

## Adding Features

### New CLI Command

```typescript
// In bin/cli.ts
program
  .command("newcmd")
  .description("Description here")
  .requiredOption("-n, --name <name>", "Required option")
  .option("-o, --optional <value>", "Optional")
  .action(async (options) => {
    ensureDb();
    // Implementation
    console.log(`✓ Success message`);
  });
```

### New API Endpoint

```typescript
// In src/server/index.ts, inside handleRequest()

// GET /api/newroute
if (pathname === "/api/newroute" && method === "GET") {
  const result = someQuery();
  return success(result);
}

// POST /api/newroute
if (pathname === "/api/newroute" && method === "POST") {
  const body = await parseBody<{ field: string }>(req);
  if (!body || !body.field) {
    return error("Missing required field");
  }
  const result = createSomething(body);
  return success(result);
}
```

### New Database Query

```typescript
// In src/db/queries.ts
export function newQuery(param: string): ResultType {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM table WHERE column = ?`);
  return stmt.get(param) as ResultType;
}
```

## Console Log Levels

The service captures these Playwright console types:
- `error` → maps to `error`
- `warning` → maps to `warn`
- `info` → maps to `info`
- `log` → maps to `log`
- `debug`, `trace` → maps to `debug`
- `assert` → maps to `error`

## Common Operations

### Scan an app
```bash
service-consolelog scan --app myapp
```

### View errors
```bash
service-consolelog logs --app myapp --level error
```

### Start continuous monitoring
```bash
service-consolelog watch start --app myapp --interval 5
```

### Query via API
```bash
curl "http://localhost:3100/api/logs?appId=1&level=error"
```

## Hook Integration

This service is designed to be called by Claude Code hooks:

1. **PostToolUse hook** triggers after Write/Edit
2. Hook calls `service-consolelog scan --app current-project`
3. Hook reads errors from output or queries API
4. Hook returns errors to agent context for fixing

## Local Files

When initialized in a project (`service-consolelog init`):
```
.service-consolelog/
├── README.md              # Local docs
└── service-consolelog.log # Activity log
```

Global config: `~/.consolelog.json`

## Repository Context

- **Owner:** Hasna (dev@hasna.com)
- **Organization:** Hasna
- **Pattern:** service-<name>
- **Runtime:** Bun
- **Database:** SQLite
