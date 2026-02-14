# CLAUDE.md

Claude-specific instructions for working with this codebase.

## CRITICAL: This is a SCAFFOLD Template

**This is NOT a real project yet.** It's a scaffold template with placeholder variables.

### Placeholders to Replace

- `{{name}}` - Service name (e.g., "prompt", "billing")
- `{{description}}` - Service description
- `{{author}}` - Author name/email

### Transformation Process

When creating a new service from this scaffold:

1. Replace all occurrences of `{{name}}` with the actual service name
2. Replace all occurrences of `{{description}}` with a real description
3. Replace all occurrences of `{{author}}` with author information
4. Test the transformed service
5. **Update this file (CLAUDE.md)** to remove scaffold references and add project-specific instructions
6. **Update AGENTS.md** with actual project details
7. Remove or archive .template-vars

### Files Requiring Replacement

- package.json
- .env.example
- bin/cli.ts
- src/lib/config.ts
- README.md

## Project Type: Service Scaffold

This is a TypeScript service template combining:
- **CLI tool** (Commander.js) - Command-line interface
- **API server** (Bun HTTP) - REST API endpoints
- **Database** (PostgreSQL) - Data persistence

## Key Architectural Decisions

### 1. CLI-Centric Design

The CLI is the primary interface. The API server is secondary and can be run independently.

### 2. Dual Configuration

- **CLI config:** Stored in `~/.{{name}}.json` for user-specific settings
- **Server config:** Uses environment variables from `.env`

### 3. Database-First

All operations interact with PostgreSQL. No in-memory caching or state management.

### 4. Simple Installer

The `install` command deploys items to Claude/Codex directories (`~/.claude/` and `~/.codex/`).

## Claude Code Guidelines

### DO:
- Follow the existing code structure (bin/, src/lib/, src/server/, scripts/)
- Use Bun-native APIs (Bun.serve, Bun file operations)
- Add TypeScript types for all new functions
- Use parameterized queries with the `sql` tagged template
- Handle errors gracefully with try-catch
- Follow the naming convention: service-{{name}}
- Keep CLI commands focused and single-purpose
- Use environment variables for secrets, config files for preferences

### DON'T:
- Don't create new top-level directories
- Don't add heavyweight frameworks (Express, Fastify, etc.)
- Don't use ORMs (use raw SQL via postgres library)
- Don't store secrets in code or config files
- Don't break the CLI pattern established in bin/cli.ts
- Don't modify placeholder syntax if still in scaffold mode

## Common Operations

### Adding a New CLI Command

1. Open `bin/cli.ts`
2. Add new command using Commander.js pattern
3. Import necessary functions from src/lib/
4. Add error handling
5. Update README.md with usage examples

### Adding a New API Endpoint

1. Open `src/server/index.ts`
2. Add route handling in `handleRequest` function
3. Use database queries via `sql` tagged template
4. Return JSON responses with proper status codes
5. Update README.md with endpoint documentation

### Adding Database Operations

1. Create or modify files in src/lib/
2. Import `sql` from '../db'
3. Use parameterized queries: `sql\`SELECT * FROM table WHERE id = \${id}\``
4. Handle errors appropriately
5. Export functions for use in CLI or server

### Database Migrations

1. Edit `scripts/migrate.ts` to add new tables or columns
2. Run `bun run db:migrate`
3. Update seed data in `scripts/seed.ts` if needed
4. Test with `bun run db:reset`

## Testing Approach

This scaffold doesn't include a test framework. When adding tests:
- Use Bun's built-in test runner (`bun test`)
- Create a `test/` directory
- Test CLI commands, API endpoints, and database operations separately
- Use a separate test database

## Repository Context

- **Owner:** Hasna
- **Organization:** Hasna
- **Repository pattern:** scaffold-service (follows `scaffold-<name>` convention)

## After Transformation

Once this scaffold becomes a real project (e.g., service-prompt, service-billing):

1. **Update this file** with:
   - Actual project name and description
   - Project-specific architectural notes
   - Domain-specific guidelines
   - Integration points with other services
   - Deployment instructions

2. **Update AGENTS.md** with:
   - Concrete examples from the real project
   - Business logic documentation
   - API integration details
   - Common troubleshooting steps

3. **Keep documentation current** as the project evolves

## Questions to Ask

If Claude is unclear about:
- Which service this should become (prompt, billing, etc.)
- Database schema requirements
- External API integrations
- Deployment targets

**Ask the user for clarification before proceeding.**

## Remember

This is a scaffold. Treat it as a template until placeholders are replaced. Once transformed, update these docs to reflect the real project.
