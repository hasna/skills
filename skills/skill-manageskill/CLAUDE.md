# CLAUDE.md

Claude-specific instructions for working with the manageskill codebase.

## Overview

`skill-manageskill` is a TypeScript service for managing Claude Code skills. It provides a CLI tool, REST API server, and PostgreSQL database for listing, installing, removing, and configuring skills.

## Architecture

- **CLI tool** (Commander.js) - Primary interface at `bin/cli.ts`
- **API server** (Bun HTTP) - REST API at `src/server/index.ts`
- **Database** (PostgreSQL) - Data persistence at `src/db/index.ts`
- **Config** - CLI config stored in `~/.manageskill.json`, server config via `.env`

## Key Directories

- `bin/` - CLI entry point
- `src/lib/` - Core logic (api-client, config, installer, service-dir)
- `src/server/` - HTTP server
- `src/db/` - Database connection
- `scripts/` - Database migration and seeding

## Guidelines

### DO:
- Use Bun-native APIs (Bun.serve, Bun file operations)
- Add TypeScript types for all new functions
- Use parameterized queries with the `sql` tagged template
- Handle errors gracefully with try-catch
- Keep CLI commands focused and single-purpose
- Use environment variables for secrets, config files for preferences

### DON'T:
- Don't add heavyweight frameworks (Express, Fastify, etc.)
- Don't use ORMs (use raw SQL via postgres library)
- Don't store secrets in code or config files

## Common Operations

```bash
bun run dev          # Start server with auto-reload
bun run start        # Start server
bun run cli          # Run CLI tool
bun run db:migrate   # Run migrations
bun run db:seed      # Seed database
bun run db:reset     # Reset database (migrate + seed)
```
